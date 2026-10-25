import { useEffect, useRef } from 'react';
import type { HTMLAttributes } from 'react';

/** Pressão longa sem interferir no toque curto ou na rolagem da lista. */
export function useLongPress(onLongPress: () => void, enabled = true): HTMLAttributes<HTMLDivElement> {
    const callbackRef = useRef(onLongPress);
    callbackRef.current = onLongPress;
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const originRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
    const suppressClickRef = useRef(false);

    const cancel = () => {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
        originRef.current = null;
    };

    useEffect(() => {
        if (!enabled) cancel();
        return cancel;
    }, [enabled]);

    return {
        onPointerDown: (event) => {
            cancel();
            suppressClickRef.current = false;
            if (!enabled || event.button !== 0 || event.isPrimary === false) return;
            if ((event.target as Element).closest('input, button, a, select, textarea')) return;
            originRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            timerRef.current = setTimeout(() => {
                timerRef.current = undefined;
                suppressClickRef.current = true;
                navigator.vibrate?.(15);
                callbackRef.current();
            }, 450);
        },
        onPointerMove: (event) => {
            const origin = originRef.current;
            if (origin?.pointerId === event.pointerId && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
                cancel();
            }
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onClickCapture: (event) => {
            if (!suppressClickRef.current) return;
            suppressClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
        },
        onContextMenu: (event) => {
            if (enabled || suppressClickRef.current) event.preventDefault();
        },
    };
}
