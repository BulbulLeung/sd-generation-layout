(function () {
    "use strict";

    function getTextSeparator() {
        if (
            typeof opts !== "undefined" &&
            opts.extra_networks_add_text_separator != null
        ) {
            return String(opts.extra_networks_add_text_separator);
        }
        return ", ";
    }

    function endsWithCommaSegment(text) {
        return /,\s*$/.test(text);
    }

    function getLineIndexForPos(text, pos) {
        if (pos <= 0) {
            return 0;
        }
        return text.slice(0, pos).split("\n").length - 1;
    }

    function mapCaretInLine(
        oldLine,
        newLine,
        posInLine,
        removedStart,
        removedEnd,
    ) {
        if (removedStart < 0) {
            return Math.min(Math.max(0, posInLine), newLine.length);
        }

        if (posInLine >= oldLine.length) {
            return newLine.length;
        }

        let pos = posInLine;
        if (pos <= removedStart) {
            pos = posInLine;
        } else if (pos >= removedEnd) {
            pos -= removedEnd - removedStart;
        } else {
            pos = removedStart;
        }

        return Math.max(0, Math.min(pos, newLine.length));
    }

    function findTargetLine(lines, lineContains, cursorLine) {
        let fallbackLine = -1;

        for (let i = 0; i < lines.length; i++) {
            if (!lineContains(lines[i], i)) {
                continue;
            }
            if (i === cursorLine) {
                return i;
            }
            if (fallbackLine < 0) {
                fallbackLine = i;
            }
        }

        return fallbackLine;
    }

    function mapSelectionAfterRemove(
        lines,
        processed,
        selectionPos,
        tokenLine,
        cursorLine,
    ) {
        let oldPos = 0;
        let newPos = 0;

        for (let i = 0; i < lines.length; i++) {
            const oldLine = lines[i];
            const entry = processed[i];
            const newLine = entry.line;

            if (i === tokenLine) {
                const posInLine =
                    cursorLine === tokenLine
                        ? selectionPos - oldPos
                        : entry.removedStart >= 0
                          ? entry.removedStart
                          : 0;
                return (
                    newPos +
                    mapCaretInLine(
                        oldLine,
                        newLine,
                        posInLine,
                        entry.removedStart,
                        entry.removedEnd,
                    )
                );
            }

            oldPos += oldLine.length + (i < lines.length - 1 ? 1 : 0);
            newPos += newLine.length + (i < processed.length - 1 ? 1 : 0);
        }

        return newPos;
    }

    function clampSelection(caret, caretEnd, textLength) {
        let start = Math.max(0, Math.min(caret, textLength));
        let end = Math.max(0, Math.min(caretEnd, textLength));
        if (end < start) {
            end = start;
        }
        return { caret: start, caretEnd: end };
    }

    function removeLinesWithCaret(prompt, selectionStart, selectionEnd, config) {
        const lineContains = config.lineContains;
        const removeFromLine = config.removeFromLine;
        const hasMatch =
            typeof config.promptContains === "function"
                ? config.promptContains(prompt)
                : prompt.split("\n").some(function (line) {
                      return lineContains(line, -1);
                  });

        if (!hasMatch) {
            return {
                text: prompt,
                caret: selectionStart,
                caretEnd: selectionEnd,
            };
        }

        const normalized = prompt.replace(/\r\n/g, "\n");
        const lines = normalized.split("\n");
        const cursorLine = getLineIndexForPos(normalized, selectionStart);
        const tokenLine = findTargetLine(lines, lineContains, cursorLine);

        const processed = lines.map(function (line) {
            return removeFromLine(line);
        });
        const text = processed
            .map(function (entry) {
                return entry.line;
            })
            .join("\n");

        let caret = mapSelectionAfterRemove(
            lines,
            processed,
            selectionStart,
            tokenLine,
            cursorLine,
        );
        let caretEnd = mapSelectionAfterRemove(
            lines,
            processed,
            selectionEnd,
            tokenLine,
            cursorLine,
        );

        const clamped = clampSelection(caret, caretEnd, text.length);
        return {
            text: text,
            caret: clamped.caret,
            caretEnd: clamped.caretEnd,
        };
    }

    function getPromptInsertContext(textarea) {
        const value = textarea.value;
        const cursor =
            typeof textarea.selectionStart === "number"
                ? textarea.selectionStart
                : value.length;
        const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
        const linePrefix = value.slice(lineStart, cursor);
        const commaIdx = linePrefix.lastIndexOf(",");
        if (commaIdx >= 0) {
            let pos = lineStart + commaIdx + 1;
            while (pos < value.length && value[pos] === " ") {
                pos++;
            }
            return { insertAt: pos, mode: "afterComma", cursor: cursor };
        }
        return { insertAt: lineStart, mode: "lineStart", cursor: cursor };
    }

    function buildInsertText(value, insertAt, mode, cursor, text) {
        const before = value.slice(0, insertAt);
        const after = value.slice(insertAt);
        const sep = getTextSeparator();
        let insert = text;

        if (mode === "lineStart") {
            insert = insert + sep;
        } else {
            const snappedToComma = insertAt !== cursor;

            if (before.length > 0 && (snappedToComma || after.length === 0)) {
                if (!before.endsWith(",") && !endsWithCommaSegment(before)) {
                    insert = sep + insert;
                }
            }

            if (after.length > 0 && (snappedToComma || before.length === 0)) {
                if (!/^\s*,/.test(after)) {
                    insert = insert + sep;
                }
            }
        }

        return {
            value: before + insert + after,
            caret: before.length + insert.length,
        };
    }

    function getLineHeight(textarea) {
        const style = getComputedStyle(textarea);
        const lineHeight = parseFloat(style.lineHeight);
        if (!Number.isNaN(lineHeight) && lineHeight > 0) {
            return lineHeight;
        }
        const fontSize = parseFloat(style.fontSize);
        if (!Number.isNaN(fontSize) && fontSize > 0) {
            return fontSize * 1.2;
        }
        return 16;
    }

    function scrollCaretLineIntoView(textarea, pos) {
        if (!textarea || typeof pos !== "number") {
            return;
        }

        const lineHeight = getLineHeight(textarea);
        const textBefore = textarea.value.slice(0, Math.max(0, pos));
        const lineIndex = textBefore.split("\n").length - 1;
        const caretTop = lineIndex * lineHeight;
        const caretBottom = caretTop + lineHeight;
        const scrollTop = textarea.scrollTop;
        const clientHeight = textarea.clientHeight;

        if (caretTop < scrollTop) {
            textarea.scrollTop = caretTop;
        } else if (caretBottom > scrollTop + clientHeight) {
            textarea.scrollTop = caretBottom - clientHeight;
        }
    }

    function applyEdit(textarea, options) {
        if (!textarea || !options) {
            return;
        }

        const value = options.value;
        const caret =
            typeof options.caret === "number"
                ? options.caret
                : typeof textarea.selectionStart === "number"
                  ? textarea.selectionStart
                  : value.length;
        const caretEnd =
            typeof options.caretEnd === "number" ? options.caretEnd : caret;
        const scroll = options.scroll || "none";

        if (textarea.value !== value) {
            textarea.value = value;
        }

        textarea.focus();
        textarea.selectionStart = caret;
        textarea.selectionEnd = caretEnd;

        if (typeof updateInput === "function") {
            updateInput(textarea);
        }

        if (scroll === "caretLineIfNeeded") {
            scrollCaretLineIntoView(textarea, caret);
        }
    }

    function insertAtContext(textarea, text, options) {
        if (!textarea || text == null) {
            return;
        }

        const value = textarea.value;
        const { insertAt, mode, cursor } = getPromptInsertContext(textarea);
        const built = buildInsertText(value, insertAt, mode, cursor, text);
        const scroll =
            options && options.scroll ? options.scroll : "none";

        applyEdit(textarea, {
            value: built.value,
            caret: built.caret,
            caretEnd: built.caret,
            scroll: scroll,
        });
    }

    function escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function removeWildcardTokenFromLine(line, token) {
        if (line.indexOf(token) < 0) {
            return {
                line: line,
                removedStart: -1,
                removedEnd: -1,
            };
        }

        const escaped = escapeRegex(token);
        const patterns = [
            new RegExp(escaped + "[ \\t]*,[ \\t]*"),
            new RegExp(escaped),
        ];

        let result = line;
        let removedStart = -1;
        let removedEnd = -1;

        for (let i = 0; i < patterns.length; i++) {
            const match = patterns[i].exec(line);
            if (match) {
                removedStart = match.index;
                removedEnd = match.index + match[0].length;
                result = line.replace(patterns[i], "");
                break;
            }
        }

        result = result.replace(/[ \t]{2,}/g, " ").trimEnd();
        if (result.length > 0 && !result.endsWith(",")) {
            result += ",";
        }

        return {
            line: result,
            removedStart: removedStart,
            removedEnd: removedEnd,
        };
    }

    function removeWildcardTokenWithCaret(prompt, token, selectionStart, selectionEnd) {
        return removeLinesWithCaret(prompt, selectionStart, selectionEnd, {
            promptContains: function (text) {
                return text.indexOf(token) >= 0;
            },
            lineContains: function (line) {
                return line.indexOf(token) >= 0;
            },
            removeFromLine: function (line) {
                return removeWildcardTokenFromLine(line, token);
            },
        });
    }

    function extractLoraKey(text) {
        const m = String(text || "").match(/<lora:([^:>]+):[\d.]+>/);
        return m ? m[1] : null;
    }

    function buildLoraTokenPattern(loraKey) {
        return "<lora:" + escapeRegex(loraKey) + ":[\\d.]+>";
    }

    function removeLoraFromLine(line, loraKey, activationText) {
        const tokenPart = buildLoraTokenPattern(loraKey);
        if (!new RegExp(tokenPart).test(line || "")) {
            return {
                line: line,
                removedStart: -1,
                removedEnd: -1,
            };
        }

        const sep = getTextSeparator();
        const patterns = [];
        if (sep.length > 0) {
            patterns.push(new RegExp(escapeRegex(sep) + tokenPart));
        }
        patterns.push(new RegExp(tokenPart + "[ \\t]*,[ \\t]*"));
        patterns.push(new RegExp(tokenPart));

        let result = line;
        let removedStart = -1;
        let removedEnd = -1;

        for (let i = 0; i < patterns.length; i++) {
            const match = patterns[i].exec(line);
            if (match) {
                removedStart = match.index;
                removedEnd = match.index + match[0].length;
                if (activationText) {
                    const afterToken = line.slice(removedEnd);
                    if (afterToken.startsWith(activationText)) {
                        removedEnd += activationText.length;
                    } else {
                        const trimmedSuffix = activationText.trimStart();
                        const trimmedAfter = afterToken.trimStart();
                        if (
                            trimmedSuffix &&
                            trimmedAfter.startsWith(trimmedSuffix)
                        ) {
                            const leadSpace =
                                afterToken.length - afterToken.trimStart().length;
                            let end = leadSpace + trimmedSuffix.length;
                            if (afterToken[end] === " ") {
                                end += 1;
                            }
                            removedEnd += end;
                        }
                    }
                }
                result = line.slice(0, removedStart) + line.slice(removedEnd);
                break;
            }
        }

        result = result.replace(/[ \t]{2,}/g, " ").trimEnd();
        if (result.length > 0 && !result.endsWith(",")) {
            result += ",";
        }

        return {
            line: result,
            removedStart: removedStart,
            removedEnd: removedEnd,
        };
    }

    function removeLoraWithCaret(
        prompt,
        loraKey,
        selectionStart,
        selectionEnd,
        activationText,
    ) {
        const tokenPart = buildLoraTokenPattern(loraKey);
        return removeLinesWithCaret(prompt, selectionStart, selectionEnd, {
            promptContains: function (text) {
                return new RegExp(tokenPart).test(text || "");
            },
            lineContains: function (line) {
                return new RegExp(tokenPart).test(line || "");
            },
            removeFromLine: function (line) {
                return removeLoraFromLine(line, loraKey, activationText || "");
            },
        });
    }

    function promptContainsExtraNetwork(prompt, text, isNeg) {
        if (isNeg) {
            return /\([^:^>]+:[\d.]+\)/.test(prompt || "");
        }
        const loraKey = extractLoraKey(text);
        if (loraKey) {
            return new RegExp(buildLoraTokenPattern(loraKey)).test(prompt || "");
        }
        const sep = getTextSeparator();
        const escaped = escapeRegex(text);
        return new RegExp("(?:" + escapeRegex(sep) + ")?" + escaped).test(
            prompt || "",
        );
    }

    function removeExtraNetworkWithCaret(
        prompt,
        text,
        isNeg,
        selectionStart,
        selectionEnd,
        activationText,
    ) {
        if (!promptContainsExtraNetwork(prompt, text, isNeg)) {
            return null;
        }

        if (isNeg) {
            const re = /\(([^:^>]+:[\d.]+)\)/g;
            let partToSearch = null;
            const m = text.match(/\(([^:^>]+:[\d.]+)\)/);
            if (m) {
                partToSearch = m[1];
            }
            const normalized = prompt.replace(/\r\n/g, "\n");
            let newText = normalized.replace(re, function (found, net) {
                if (partToSearch && net === partToSearch) {
                    return "";
                }
                return found;
            });
            if (newText === normalized) {
                return null;
            }
            const clamped = clampSelection(
                selectionStart,
                selectionEnd,
                newText.length,
            );
            return {
                text: newText,
                caret: clamped.caret,
                caretEnd: clamped.caretEnd,
            };
        }

        const loraKey = extractLoraKey(text);
        if (loraKey) {
            return removeLoraWithCaret(
                prompt,
                loraKey,
                selectionStart,
                selectionEnd,
                activationText || "",
            );
        }

        const sep = getTextSeparator();
        const escaped = escapeRegex(text);
        const pattern = new RegExp("(?:" + escapeRegex(sep) + ")?" + escaped);

        return removeLinesWithCaret(prompt, selectionStart, selectionEnd, {
            promptContains: function (p) {
                return pattern.test(p || "");
            },
            lineContains: function (line) {
                return pattern.test(line || "");
            },
            removeFromLine: function (line) {
                const match = pattern.exec(line);
                if (!match) {
                    return {
                        line: line,
                        removedStart: -1,
                        removedEnd: -1,
                    };
                }
                let result = line.replace(pattern, "");
                result = result.replace(/[ \t]{2,}/g, " ").trimEnd();
                if (result.length > 0 && !result.endsWith(",")) {
                    result += ",";
                }
                return {
                    line: result,
                    removedStart: match.index,
                    removedEnd: match.index + match[0].length,
                };
            },
        });
    }

    window.genLayoutPromptCaret = {
        applyEdit: applyEdit,
        insertAtContext: insertAtContext,
        removeLinesWithCaret: removeLinesWithCaret,
        removeWildcardTokenWithCaret: removeWildcardTokenWithCaret,
        removeLoraWithCaret: removeLoraWithCaret,
        removeExtraNetworkWithCaret: removeExtraNetworkWithCaret,
        scrollCaretLineIntoView: scrollCaretLineIntoView,
        getPromptInsertContext: getPromptInsertContext,
        buildInsertText: buildInsertText,
        mapCaretInLine: mapCaretInLine,
        mapSelectionAfterRemove: mapSelectionAfterRemove,
        getLineIndexForPos: getLineIndexForPos,
    };
})();
