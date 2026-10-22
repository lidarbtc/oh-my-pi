import { describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER, Editor } from "@oh-my-pi/pi-tui";
import { detectTerminalId, getTerminalInfo } from "@oh-my-pi/pi-tui/terminal-capabilities";

import { getHangulCompatibilityJamoWidth, setHangulCompatibilityJamoWidth, visibleWidth } from "@oh-my-pi/pi-tui/utils";
import { defaultEditorTheme } from "./test-themes";

function jamoWidthFor(env: NodeJS.ProcessEnv): "platform" | "unicode" | 1 | 2 {
	return getTerminalInfo(detectTerminalId(env)).hangulJamoWidth;
}

describe("Hangul Compatibility Jamo width terminal capability", () => {
	it("prevents Korean IME cursor drift by matching terminal-specific Hangul Compatibility Jamo widths", () => {
		// Ghostty, WezTerm and Orca follow UAX#11 and render Hangul Compatibility Jamo at
		// 2 cells; Warp renders them at 1 cell. Every other terminal keeps the
		// platform default (macOS narrow, otherwise UAX#11).
		expect(jamoWidthFor({ GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app" })).toBe(2);
		expect(jamoWidthFor({ TERM_PROGRAM: "ghostty" })).toBe(2);
		// Ghostty identified only via TERM (env-filtered shells that drop
		// GHOSTTY_RESOURCES_DIR / TERM_PROGRAM) must still resolve wide — mirrors
		// the Ghostty detection in terminal-capabilities.ts.
		expect(jamoWidthFor({ TERM: "xterm-ghostty" })).toBe(2);
		expect(jamoWidthFor({ TERM_PROGRAM: "WezTerm" })).toBe(2);
		expect(jamoWidthFor({ WEZTERM_PANE: "0" })).toBe(2);
		expect(jamoWidthFor({ TERM_PROGRAM: "WarpTerminal" })).toBe(1);
		expect(jamoWidthFor({ TERM_PROGRAM: "Orca", TERM: "xterm-256color", COLORTERM: "truecolor" })).toBe(2);
		expect(jamoWidthFor({ TERM_PROGRAM: "iTerm.app" })).toBe("platform");
		expect(jamoWidthFor({ TERM_PROGRAM: "Apple_Terminal" })).toBe("platform");
		expect(jamoWidthFor({})).toBe("platform");
	});
});

describe("WezTerm Korean input rendering", () => {
	it("keeps repeated initials, Space and arrow navigation aligned without changing composed Hangul", () => {
		const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
		const previousWidth = getHangulCompatibilityJamoWidth();
		try {
			// Exercise the macOS fallback even when this test runs on Linux CI.
			Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
			setHangulCompatibilityJamoWidth(jamoWidthFor({ TERM_PROGRAM: "WezTerm" }));
			for (const imeSafeCursor of [false, true]) {
				const editor = new Editor(defaultEditorTheme);
				editor.focused = true;
				editor.setImeSafeCursorLayout(imeSafeCursor);
				const cursorColumn = (): number => {
					const lines = editor.render(40);
					const cursorLine = lines.find(line => line.includes(CURSOR_MARKER));
					expect(cursorLine).toBeDefined();
					for (const line of lines) {
						expect(visibleWidth(line.replaceAll(CURSOR_MARKER, ""))).toBeLessThanOrEqual(40);
					}
					return visibleWidth(cursorLine!.slice(0, cursorLine!.indexOf(CURSOR_MARKER)));
				};
				const startColumn = cursorColumn();
				for (let count = 1; count <= 5; count++) {
					editor.handleInput("ㅇ");
					expect(cursorColumn()).toBe(startColumn + count * 2);
				}
				expect(editor.getText()).toBe("ㅇㅇㅇㅇㅇ");
				editor.handleInput(" ");
				expect(cursorColumn()).toBe(startColumn + 11);
				editor.handleInput("\x1b[D"); // Left across Space
				expect(cursorColumn()).toBe(startColumn + 10);
				editor.handleInput("\x1b[D"); // Left across one two-cell initial
				expect(cursorColumn()).toBe(startColumn + 8);
				editor.handleInput("\x1b[C");
				expect(cursorColumn()).toBe(startColumn + 10);
				editor.handleInput("\x1b[C");
				expect(cursorColumn()).toBe(startColumn + 11);
				for (const syllable of "안녕") editor.handleInput(syllable);
				expect(cursorColumn()).toBe(startColumn + 15);
				expect(editor.getText()).toBe("ㅇㅇㅇㅇㅇ 안녕");
				const rendered = editor
					.render(40)
					.map(line => stripVTControlCharacters(line.replaceAll(CURSOR_MARKER, "")));
				expect(rendered.some(line => line.includes("ㅇㅇㅇㅇㅇ 안녕"))).toBe(true);
			}
		} finally {
			Object.defineProperty(process, "platform", platformDescriptor);
			setHangulCompatibilityJamoWidth(previousWidth);
		}
	});
});
