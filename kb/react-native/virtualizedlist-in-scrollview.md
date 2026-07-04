---
tech: react-native
tags: [flatlist, virtualizedlist, scrollview, performance, windowing, lists]
severity: medium
---
# Nesting a VirtualizedList in a ScrollView defeats virtualization

## PROBLEM
When a screen has a header block plus a long list, the instinct is to wrap a
`FlatList` inside a `ScrollView` so the whole thing scrolls together. That
triggers RN's warning "VirtualizedLists should never be nested inside plain
ScrollViews with the same orientation." Worse than the warning: it silently
defeats windowing. The inner list never receives a scroll offset (the outer
ScrollView owns the scroll), so it cannot tell what is on screen and ends up
mounting every row, the exact opposite of the intended performance win. Setting
`scrollEnabled={false}` on the inner list does not restore virtualization
either -- it just makes the dead behavior quieter.

## WRONG
```tsx
<ScrollView>
  <Header />
  <FlatList
    data={messages}
    renderItem={renderItem}
    scrollEnabled={false}   // does NOT fix virtualization
  />
  <Footer />
</ScrollView>
```

## RIGHT
```tsx
// The list itself is the scroll container. Header/footer move into the list;
// pinned bars overlay absolutely instead of wrapping the list in a ScrollView.
<View style={{ flex: 1 }}>
  <FlatList
    data={messages}
    renderItem={renderItem}
    ListHeaderComponent={<Header />}
    ListFooterComponent={<Footer />}
    ItemSeparatorComponent={Gap}
    initialNumToRender={12}
    windowSize={9}
  />
  <PinnedBar style={{ position: "absolute", bottom: 0, left: 0, right: 0 }} />
</View>
```

## NOTES
Only fall back to a plain `messages.map()` inside a `View`/`ScrollView` when the
list is guaranteed short. If you need multiple independent scrolling sections,
use a single `SectionList` (or one FlatList with a header) rather than nesting
lists. Related: memoize `renderItem`/`keyExtractor` and the row component so the
windowed rows do not re-render on every parent pass.
