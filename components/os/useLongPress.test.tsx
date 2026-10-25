// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPress } from './useLongPress';

const pointer = (x = 0, y = 0, extra: Record<string, unknown> = {}) => ({
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: x,
    clientY: y,
    target: document.createElement('div'),
    currentTarget: { setPointerCapture: vi.fn() },
    ...extra,
}) as never;

describe('useLongPress', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true });
    });
    afterEach(() => vi.useRealTimers());

    it('dispara após 450ms e vibra', () => {
        const fn = vi.fn();
        const { result } = renderHook(() => useLongPress(fn));
        act(() => { result.current.onPointerDown!(pointer()); });
        act(() => { vi.advanceTimersByTime(449); });
        expect(fn).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1); });
        expect(fn).toHaveBeenCalledTimes(1);
        expect(navigator.vibrate).toHaveBeenCalledWith(15);
    });

    it('cancela ao soltar, mover mais de 10px ou desabilitar', () => {
        const fn = vi.fn();
        const { result, rerender } = renderHook(({ on }) => useLongPress(fn, on), { initialProps: { on: true } });
        act(() => { result.current.onPointerDown!(pointer()); });
        act(() => { result.current.onPointerUp!(pointer()); vi.advanceTimersByTime(600); });
        act(() => { result.current.onPointerDown!(pointer()); });
        act(() => { result.current.onPointerMove!(pointer(11, 0)); vi.advanceTimersByTime(600); });
        act(() => { result.current.onPointerDown!(pointer()); });
        act(() => { result.current.onPointerMove!(pointer(5, 0)); vi.advanceTimersByTime(450); });
        expect(fn).toHaveBeenCalledTimes(1);
        rerender({ on: false });
        act(() => { result.current.onPointerDown!(pointer()); vi.advanceTimersByTime(600); });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('suprime o clique após o toque longo, uma única vez', () => {
        const { result } = renderHook(() => useLongPress(vi.fn()));
        act(() => { result.current.onPointerDown!(pointer()); vi.advanceTimersByTime(450); });
        const stop = vi.fn();
        const prevent = vi.fn();
        result.current.onClickCapture!({ stopPropagation: stop, preventDefault: prevent } as never);
        expect(stop).toHaveBeenCalledTimes(1);
        result.current.onClickCapture!({ stopPropagation: stop, preventDefault: prevent } as never);
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
