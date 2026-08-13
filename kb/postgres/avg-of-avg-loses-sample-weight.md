---
tech: postgres
tags: [rollup, aggregate, avg, time-series, materialized, weighted-mean, downsampling, metrics]
severity: high
---
# Rolling an aggregate up again with avg(avg) silently drops the sample weight

## PROBLEM

Tiered time-series rollups are built by aggregating the tier below: 5-minute buckets from raw points, hourly from 5-minute, daily from hourly. Building each tier from raw instead is the obvious alternative and is usually rejected for good reason -- rolling hourly from raw rescans sixty times the rows for the same answer.

The moment you aggregate an aggregate, `avg(value_avg)` stops being the average. It is the average *of the bucket averages*, which weighs a bucket built from 3 samples exactly as heavily as one built from 300.

This is nasty because it is invisible in every reasonable test. Buckets in steady state all carry the same `sample_count`, so the weighted and unweighted means agree exactly, and a fixture with uniform buckets passes. The counts only diverge where a device was offline, where an agent was catching up, at the edges of a partition, and in the bucket that is still filling -- which is to say, precisely around the incidents someone is looking at the chart to understand.

Worse, `min`/`max` have the same failure in a different disguise: `min(value_avg)` is the smallest *average*, not the smallest value. A 3-second CPU spike that pushed one 5-minute bucket's max to 99 disappears entirely from the hourly tier if the hourly row takes extremes of averages, so the chart gets smoother and calmer at every zoom level while the incident quietly vanishes.

Measured on real data: two 5-minute buckets, one with 300 samples averaging 10 and one with 3 samples averaging 90. Weighted, the hour is **10.79**. With `avg(avg)` it is **50** -- a five-fold error, on a chart nobody will double-check.

## WRONG

```sql
-- Hourly from 5-minute. Reads correctly, is wrong whenever sample counts differ.
INSERT INTO metric_rollups_hourly
  (device_id, metric, bucket_at, value_avg, value_min, value_max, sample_count)
SELECT device_id, metric,
       date_trunc('hour', bucket_at),
       avg(value_avg),        -- weighs a 3-sample bucket like a 300-sample one
       min(value_avg),        -- smallest average, not the smallest value
       max(value_avg),        -- the spike is gone: it was never in an average
       count(*)               -- counts BUCKETS, not the samples behind them
  FROM metric_rollups_5m
 WHERE bucket_at >= $1 AND bucket_at < $2
 GROUP BY device_id, metric, date_trunc('hour', bucket_at);
```

## RIGHT

```sql
-- Carry sample_count through every tier and weight by it.
INSERT INTO metric_rollups_hourly
  (device_id, metric, bucket_at, value_avg, value_min, value_max, sample_count)
SELECT device_id, metric,
       date_trunc('hour', bucket_at),
       -- Weighted mean. NULLIF guards a window whose counts are all zero,
       -- which yields NULL rather than a division error.
       sum(value_avg * sample_count) / NULLIF(sum(sample_count), 0),
       min(value_min),          -- true extremes, carried up from the tier below
       max(value_max),
       sum(sample_count)::int   -- samples, so the next tier up can weight too
  FROM metric_rollups_5m
 WHERE bucket_at >= $1 AND bucket_at < $2
 GROUP BY device_id, metric, date_trunc('hour', bucket_at);
```

The invariant to hold on to: **every rollup row must carry the number of raw samples underneath it**, and each tier must aggregate `min(value_min)` / `max(value_max)` / `sum(sample_count)` rather than re-aggregating the average column. Without `sample_count` on the row, the weighted mean is not merely inconvenient to write -- it is unrecoverable, and the only fix is recomputing from raw, which may already have been dropped by retention.

## NOTES

- Test with **deliberately unequal** sample counts. Uniform fixtures cannot fail: they make the weighted and unweighted results identical, so the test passes for the wrong reason.
- Verify against real data before trusting it. A one-off check in a rolled-back transaction is enough -- insert two buckets with counts like 300 and 3, roll them up, and confirm the result is near the heavy bucket rather than midway between the two.
- The first tier (raw -> 5m) is the exception and needs `avg(value)`, `min(value)`, `max(value)`, `count(*)`: raw points carry one sample each, so there is nothing to weight yet. Sharing one SQL string across both cases is where this bug usually enters -- keep the raw-source and rollup-source expressions separate and comment why.
- Not specific to metrics. The same error appears in any tiered summary: average order value rolled from daily to monthly, mean response time from per-endpoint to per-service, average score from per-question to per-assessment.
- `count(*)` in the rollup-of-rollup counts *buckets*, which then silently corrupts every tier above it even if someone later fixes the average. Fix `sample_count` first.
