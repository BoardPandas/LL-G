---
tech: wpf
tags: [xaml, binding, templatebinding, stringformat, controltemplate]
severity: high
---
# TemplateBinding does no type conversion; StringFormat is ignored on object-typed targets

## PROBLEM
Two WPF binding behaviors combine into a silently empty control:

1. `TemplateBinding` is a compile-time optimized binding with NO value
   conversion. Binding a non-string source (e.g. `Content` holding a `double`)
   to a string target (e.g. `TextBlock.Text`) inside a ControlTemplate fails
   silently -- the target just stays empty. A regular `Binding` would have
   converted via `ToString()`.
2. `Binding.StringFormat` only applies when the TARGET property is typed
   `string`. Setting it on a binding into `ContentControl.Content` (typed
   `object`) is silently ignored, so the "formatting" never happens either.

Together: a templated value chip bound like
`Content="{Binding Value, ElementName=Slider, StringFormat={}{0:F1}}"` with a
template using `<TextBlock Text="{TemplateBinding Content}"/>` renders nothing,
with no binding error in the output window.

## WRONG
```xml
<!-- Template -->
<ControlTemplate TargetType="ContentControl">
    <Border><TextBlock Text="{TemplateBinding Content}"/></Border>
</ControlTemplate>

<!-- Usage: StringFormat ignored (Content is object), TemplateBinding won't convert double->string -->
<ContentControl Content="{Binding ElementName=Slider, Path=Value, StringFormat={}{0:F1}}"/>
```

## RIGHT
```xml
<!-- Template: ContentPresenter honors ContentStringFormat -->
<ControlTemplate TargetType="ContentControl">
    <Border><ContentPresenter/></Border>
</ControlTemplate>

<!-- Usage: format via ContentStringFormat, not Binding.StringFormat -->
<ContentControl Content="{Binding ElementName=Slider, Path=Value}"
                ContentStringFormat="F1"/>
```

## NOTES
- Same family of gotcha: `TemplateBinding` to `ActualWidth` (e.g. sizing a
  ComboBox popup) is unreliable; use
  `{Binding ActualWidth, RelativeSource={RelativeSource TemplatedParent}}`.
- Set font properties on the ContentControl (they inherit into the
  ContentPresenter) instead of on a TextBlock inside the template.
- Found while building themed value chips for slider readouts
  (DeafDirectionalHelper UI overhaul, 2026-07).
