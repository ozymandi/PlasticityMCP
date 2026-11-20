# Spec Delta

## Purpose

Opening documents from disk without hanging the window: the path rules Plasticity 26.1.3 needs, enforced before it is asked to open anything.

## ADDED Requirements

### Requirement: Plain-ASCII paths only
`open_document` SHALL refuse at once, without asking Plasticity, a path that contains non-ASCII characters (Cyrillic letters, typographic apostrophes, accents), because Plasticity 26.1.3 hangs when it opens such a path. The refusal SHALL tell the caller to copy the file to a path of plain Latin letters, digits and punctuation.

#### Scenario: Cyrillic folder
- **WHEN** `open_document` is called with a path under a folder named in Cyrillic
- **THEN** it fails within two seconds with a message that names non-ASCII paths and the copy advice

#### Scenario: ASCII path
- **WHEN** `open_document` is called with a plain-ASCII path to a saved document
- **THEN** the document opens in place of the current one
