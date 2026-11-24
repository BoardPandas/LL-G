---
tech: pandadoc
tags: [pandadoc, editor, contenteditable, execcommand, browser-automation, signing]
severity: high
---
# PandaDoc edit that survives a reload can still be missing from the sent document

## PROBLEM
Automating the PandaDoc document editor in a browser, a sentence was replaced by selecting it
programmatically, pressing Delete, then calling `document.execCommand('insertText', ...)`. After a
full page reload the editor showed the new text, so it looked saved. The copy sent with "Review and
send" and signed still had the old sentence. Other edits from the same session (insertText at a
clicked caret, new paragraphs from real Enter key presses) did reach the signed copy. A reload is
not proof that an edit is in the version recipients will sign.

Separately, `execCommand('insertParagraph')` inside a PandaDoc text block replaced the whole
paragraph block's content instead of splitting it.

## WRONG
```js
// select a range in an inactive block, then rely on a reload to confirm
sel.addRange(rangeOverOldSentence);
pressKey('Delete');
doc.execCommand('insertText', false, newSentence);
doc.execCommand('insertParagraph');            // wipes the block
location.reload();                             // shows new text -> assumed saved
```

## RIGHT
```js
click(atSentenceStart);                        // real click activates the block
doc.execCommand('insertText', false, text);    // insert at a real caret
pressKey('Enter');                             // real key for new paragraphs
```
Before sending, open the document preview (or download the PDF) and check every edited clause. After
signing, compare the signed PDF against the intended text and fix gaps with an amendment.

## NOTES
- Verify the generated PDF, not the editor DOM.
- Undo (Ctrl+Z) restored the block that insertParagraph wiped.
