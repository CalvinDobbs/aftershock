import { describe, expect, it } from 'vitest';
import { readValues, sayLabel, saySpec, sayValue, sayDelta, sayFailure, shortSource, shortTitle, splitClaim, trim } from './voice';

/**
 * Every input here is a real string taken off a live run, not an invented one.
 * The point of this module is that the room stops reading like a machine, and
 * the only way to hold that is to pin the actual sentences it produced.
 */

describe('reading an accessibility readout', () => {
  it('drops the role and keeps the value', () => {
    expect(readValues('StaticText: $84.00').values).toEqual(['$84.00']);
  });

  it('treats a dash as nothing rather than as a value', () => {
    const { values, allEmpty } = readValues('StaticText: —');
    expect(values).toEqual([]);
    expect(allEmpty).toBe(true);
  });

  it('drops a role that arrived with no value at all', () => {
    // `definition` here described a node's shape; the node was empty.
    const { values } = readValues('StaticText: Coupon applied.; StaticText: —; definition; term: Discount');
    expect(values).toEqual(['Coupon applied', 'Discount']);
  });

  it('collapses repeats, because three lines reading $NaN is one observation', () => {
    expect(readValues('StaticText: $NaN; StaticText: $NaN; StaticText: $NaN').values).toEqual(['$NaN']);
  });

  it('strips the per-session node ids Stagehand stamps on', () => {
    expect(readValues('StaticText [12-4]: $84.00').values).toEqual(['$84.00']);
  });
});

describe('splitting a finding into claim and observation', () => {
  it('removes the "Assertion violated" label every finding carries', () => {
    const { claim } = splitClaim('Assertion violated: The discount row is present.');
    expect(claim).toBe('The discount row is present.');
  });

  it('splits on Observed even when the observation itself has full stops', () => {
    const { claim, observed } = splitClaim(
      'Assertion violated: When a coupon is applied, the order summary shows the discount percent. Observed: StaticText: Coupon applied. 10% off your order.; StaticText: —',
    );
    expect(claim).toBe('When a coupon is applied, the order summary shows the discount percent');
    expect(observed).toBe('StaticText: Coupon applied. 10% off your order.; StaticText: —');
  });
});

describe('saying a failure the way a person would', () => {
  it('reports an empty render as nothing rather than as a dash', () => {
    const said = sayFailure(
      'Assertion violated: Removing an applied coupon resets the discount in the order summary and allows entering a new code. Observed: StaticText: —',
    );
    expect(said).toBe(
      'Removing an applied coupon resets the discount in the order summary and allows entering a new code — but nothing rendered there at all.',
    );
    expect(said).not.toMatch(/StaticText|Observed|Assertion violated/);
  });

  it('names the values that did come back, without a doubled full stop', () => {
    const said = sayFailure(
      'Assertion violated: With a valid coupon code applied, the order summary shows the discount percentage. Observed: StaticText: $84.00; StaticText: Coupon applied. 20% off your order.; StaticText: —',
    );
    expect(said).toContain('$84.00');
    expect(said).toContain('Coupon applied. 20% off your order”');
    expect(said).not.toMatch(/\.["”]\./);
    expect(said).not.toMatch(/StaticText/);
  });

  it('leaves a finding that was never machine-framed alone', () => {
    const plain = 'The cart subtotal disagrees with the sum of its lines.';
    expect(sayFailure(plain)).toBe(plain);
  });
});

describe('titles that have to survive one line', () => {
  it('cuts the real $NaN finding at its semicolon', () => {
    expect(
      shortTitle(
        '3 values render as $NaN where base shows $84.00, $28.00, $112.00; nothing in the diff claimed this would change',
      ),
    ).toBe('3 values render as $NaN where base shows $84.00, $28.00, $112.00');
  });

  it('keeps a short title whole and unpunctuated at the end', () => {
    expect(shortTitle('The discount row is empty.')).toBe('The discount row is empty');
  });

  it('never returns more than the budget', () => {
    const long = 'a'.repeat(400);
    expect(shortTitle(long).length).toBeLessThanOrEqual(97);
  });
});

describe('the provenance column', () => {
  it('keeps the location and drops the prose after it', () => {
    expect(shortSource('components/CouponInput.tsx: Discount code section and heading')).toBe(
      'components/CouponInput.tsx',
    );
  });

  it('keeps line numbers, which are the checkable part', () => {
    expect(shortSource('components/CouponInput.tsx:54-59, 66-68')).toBe(
      'components/CouponInput.tsx:54-59, 66-68',
    );
  });

  it('falls back to truncation when there is no file at all', () => {
    expect(shortSource('Core journey, not claimed to change. Compared against the base branch.')).toMatch(/…$/);
  });
});

describe('a delta, as a sentence', () => {
  it('reads base then preview', () => {
    expect(sayDelta('StaticText: $84.00', 'StaticText: $NaN')).toBe('$84.00 on main, $NaN here.');
  });

  it('says nothing rather than printing a dash', () => {
    expect(sayDelta('StaticText: $84.00', 'StaticText: —')).toBe('$84.00 on main, nothing here.');
  });
});

describe('trimming an agent to a bubble', () => {
  it('keeps whole sentences', () => {
    const t = trim('One sentence here. Two sentence here. Three sentence here.', 25);
    expect(t).toBe('One sentence here.');
  });

  it('would rather overrun than cut a single sentence in half', () => {
    const one = 'A single sentence considerably longer than the budget allows for.';
    expect(trim(one, 10)).toBe(one);
  });
});

describe('specification lines', () => {
  it('reduces a nested run of roles to the values it is about', () => {
    // Straight off the $NaN finding's `expected`.
    expect(
      saySpec(
        'StaticText "$84.00": StaticText: $84.00; StaticText "$84.00": StaticText: $84.00; StaticText "$28.00": StaticText: $28.00; StaticText "$112.00": StaticText: $112.00',
      ),
    ).toBe('$84.00, $28.00 and $112.00');
  });

  it('leaves prose that was never a spec alone', () => {
    const prose = 'The original journey still completes';
    expect(saySpec(prose)).toBe(prose);
  });

  it('caps a very long run rather than listing everything', () => {
    const many = Array.from({ length: 12 }, (_, i) => `StaticText: v${i}`).join('; ');
    expect(saySpec(many)).toMatch(/and 6 more$/);
  });
});

describe('a comparison pane', () => {
  it('names a row by the value that identifies it, not by its role', () => {
    expect(sayLabel('StaticText "$84.00"')).toBe('$84.00');
  });

  it('still reads a test id', () => {
    expect(sayLabel('[data-testid="cart-subtotal"]')).toBe('cart subtotal');
  });

  it('renders a cell as its value, or as the word for having none', () => {
    expect(sayValue('StaticText: $NaN')).toBe('$NaN');
    expect(sayValue('StaticText: —')).toBe('nothing');
  });
});
