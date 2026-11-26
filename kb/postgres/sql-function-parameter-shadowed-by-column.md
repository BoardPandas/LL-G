---
tech: postgres
tags: [sql-function, parameter-shadowing, column-name, security-definer, multi-tenant, language-sql]
severity: high
---
# In a LANGUAGE sql function a parameter named like a column is shadowed by the column

## PROBLEM
Inside a `LANGUAGE sql` function body, an unqualified name that matches both a parameter and a column of a table in the query resolves to the **column**. `WHERE o.ses_message_id = ses_message_id` therefore compares the column to itself and is true for every non-NULL row. No error, no warning.

In an ordinary lookup that returns the wrong row. In a cross-tenant `SECURITY DEFINER` routing function (one that resolves a tenant from an external ID) it returns another tenant's row, which is a tenant-isolation breach that looks like a working lookup in any test with a single row.

## WRONG
```sql
CREATE FUNCTION route_message(external_id text)
    RETURNS TABLE (tenant_id uuid, message_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    SELECT m.tenant_id, m.id
      FROM public.messages AS m
     WHERE m.external_id = external_id   -- column = column: always true
$$;
```

## RIGHT
```sql
AS $$
    SELECT m.tenant_id, m.id
      FROM public.messages AS m
     WHERE m.external_id = route_message.external_id   -- function_name.param
$$;
```
Or name parameters so they cannot collide (`p_external_id`), or use `$1`.

## NOTES
- Qualify with the function name for every parameter in every function in the schema, not only the ones you noticed.
- Test with at least two rows and assert that a lookup for one returns exactly that row, as the restricted runtime role. A one-row fixture passes with the bug.
- PL/pgSQL differs: `plpgsql.variable_conflict` defaults to `error` and raises on the ambiguity. The silent form is specific to SQL-language functions.
- Related: `force-rls-hides-rows-from-owner-owned-security-definer.md`.
