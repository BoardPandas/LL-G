---
tech: wix
tags: [wix, linker, fragment, featureref, componentgroupref, wixui, dialog, msi, silent-failure]
severity: high
---
# A WiX fragment anchored only by FeatureRef is dropped silently

## PROBLEM
The WiX linker starts at the `Package` and follows **outgoing** symbol references.
A `<Fragment>` is linked only if something already in the package references a symbol
that the fragment defines. A `<FeatureRef Id="ProductFeature">` inside the fragment
points the other way, from the fragment to the package, so it anchors nothing. The
whole fragment is discarded: its components, its `<Property>` declarations, its custom
dialog, its `<ui:WixUI>` reference and its `<Publish>` rows.

`wix build` gives no error and no warning, the source file is on the command line, and
the MSI installs. Nothing shows the gap unless you look inside the built package. In
the case behind this entry, a generic MSI shipped for five months with no enrollment
dialog. It also never wrote the `INSTALL_CODE` / `ENROLL_KEY` / `ORG` registry hints
that its own `.wxs` authored.

A related trap: once the fragment really links, a property the UI set also defines
can collide. `WixUI_Minimal` defines `ARPNOMODIFY`, so a package that sets it too fails
with `WIX0091` the first time the dialog is actually linked.

## WRONG
```xml
<!-- enroll-dialog.wxs: passed to wix build, never linked -->
<Fragment>
  <FeatureRef Id="ProductFeature">
    <ComponentRef Id="EnrollHints" />
  </FeatureRef>
  <ui:WixUI Id="WixUI_Minimal" />
  <UI> <Dialog Id="EnrollDlg" ...> ... </Dialog> </UI>
</Fragment>
```

## RIGHT
```xml
<!-- enroll-dialog.wxs: expose a symbol the package can reference -->
<Fragment>
  <ComponentGroup Id="EnrollHintComponents">
    <ComponentRef Id="EnrollHints" />
  </ComponentGroup>
  <ui:WixUI Id="WixUI_Minimal" />
  <UI> <Dialog Id="EnrollDlg" ...> ... </Dialog> </UI>
</Fragment>

<!-- product.wxs: the outgoing reference pulls in the whole fragment.
     Guard it when some builds do not compile that file. -->
<Feature Id="ProductFeature">
  <?ifdef WithEnrollment?>
  <ComponentGroupRef Id="EnrollHintComponents" />
  <?endif?>
</Feature>
<?ifndef WithEnrollment?>
<Property Id="ARPNOMODIFY" Value="1" />  <!-- WixUI_Minimal defines it otherwise -->
<?endif?>
```

## NOTES
- Check the built package, not the source. After `wix build`, open the MSI
  (`WindowsInstaller.Installer` → `OpenDatabase`) and fail the build unless the
  expected `Dialog` row and components exist. Look the table up in `_Tables` first,
  because a dropped UI fragment leaves no `Dialog` table at all.
- An XML-level test that only parses the `.wxs` passes against the broken source.
  Assert the anchoring reference itself, or inspect the MSI.
- When splicing a dialog after `WelcomeEulaDlg`, publish on both `Install` and
  `InstallNoShield`. The second button replaces the first when setup is already
  elevated.
- Seen with WiX 5.0.2 and 7.0.1. The linker behaviour is the same in both.
