import type { Action } from "@aftershock/schema/browser";
import type { BrowserSession } from "./session.js";

export function requestedInput(instruction: string): string | null {
  const match = instruction.trim().match(/^(?:enter|type|fill(?:\s+in)?)\s+["']([^"']*)["']/i);
  return match?.[1] ?? null;
}
/** Resolve an observed wrapper to exactly one editable control before typing. */
export async function resolveInput(session: BrowserSession, action: Action, value: string): Promise<Action> {
  const selector = await session.page.evaluate<string>(`(() => {
    const selector = ${JSON.stringify(action.selector)};
    const node = selector.startsWith('xpath=') ? document.evaluate(selector.slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue : document.querySelector(selector);
    if (!(node instanceof Element)) throw new Error('Input target not found');
    const inputs = node.matches('input,textarea') ? [node] : [...node.querySelectorAll('input,textarea')];
    if (inputs.length !== 1) throw new Error('Input target is ambiguous');
    let el = inputs[0]; const parts = [];
    while (el && el.nodeType === 1) { let n = 1; let prev = el.previousElementSibling; while (prev) { if (prev.tagName === el.tagName) n++; prev = prev.previousElementSibling; } parts.unshift(el.tagName.toLowerCase() + '[' + n + ']'); el = el.parentElement; }
    return 'xpath=/' + parts.join('/');
  })()`);
  return { ...action, selector, method: "fill", arguments: [value] };
}
/** Native input events reach React; a wrapper click must never masquerade as typing. */
export async function fillInput(session: BrowserSession, action: Action): Promise<void> {
  const value = action.arguments?.[0];
  if (value === undefined) throw new Error("Recorded fill has no value");
  await session.page.evaluate(`(() => {
    const selector = ${JSON.stringify(action.selector)};
    const el = selector.startsWith('xpath=') ? document.evaluate(selector.slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue : document.querySelector(selector);
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('Recorded input not found');
    if (el.disabled || el.readOnly) throw new Error('Input is not editable');
    el.focus();
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (el.value !== ${JSON.stringify(value)}) throw new Error('Input value did not persist');
  })()`);
}
