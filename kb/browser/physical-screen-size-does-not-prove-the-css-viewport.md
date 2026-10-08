---
tech: browser
tags: [responsive, viewport, browser-chrome, display-scaling, breakpoints, playwright, css-pixels]
severity: high
---
# Physical screen size does not prove the CSS viewport

## PROBLEM
A large physical display can still expose a short CSS viewport after operating-system display scaling, browser chrome, page zoom, or an embedded browser shell take their share. A height breakpoint can therefore switch a desktop into a fallback presentation even though a screenshot looks wide and high-resolution. The failure is especially deceptive when the fallback keeps the same controls but moves the result below a long list: an action can persist successfully while appearing to do nothing.

Reusing one height floor across renderers makes the problem worse when those renderers have different geometry. A legacy view sized around a 303px card may need an 800px floor, while a compact direct-manipulation scene using 180px cards and collapsible trays can remain fully usable at 720px.

## WRONG
```javascript
// A physical screen estimate and one representative viewport do not prove
// which presentation real users receive.
const useTable = screen.height >= 800;

test("desktop uses the tabletop", async () => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.locator("[data-presentation=table]")).toBeVisible();
});

// Both renderers inherit the same floor even though their cards and trays
// require different amounts of vertical space.
const presentation = height >= 800 ? "table" : "columns";
```

## RIGHT
```javascript
const LEGACY_TABLE_MIN_HEIGHT = 800;
const DIRECT_TABLE_MIN_HEIGHT = 720;

function viewport(document) {
	return {
		width: document.documentElement.clientWidth,
		height: document.documentElement.clientHeight,
	};
}

function presentationFor({ width, height }, tableMinHeight) {
	return width >= 768 && height >= tableMinHeight ? "table" : "columns";
}

test.each([
	[{ width: 768, height: 719 }, "columns"],
	[{ width: 768, height: 720 }, "table"],
	[{ width: 1024, height: 768 }, "table"],
	[{ width: 1440, height: 720 }, "table"],
])("direct scene selects and renders the usable mode at %j", async (size, expected) => {
	await page.setViewportSize(size);
	await expect(page.locator("[data-presentation]")).toHaveAttribute("data-presentation", expected);
	if (expected === "table") {
		await expect(page.locator("[data-zone=workspace]")).toBeInViewport();
		await expect(page.locator("[data-zone=incoming] [data-card]").first()).toBeInViewport();
	}
});
```

## NOTES
Record `document.documentElement.clientWidth` and `clientHeight` in owner-walk and browser-test evidence. Test immediately below and at every breakpoint, then include the owner-class viewport that exposed the defect. Assert the selected interaction mode and the visibility of its essential workspace, not merely the page width, persisted API result, or a high-resolution screenshot.
