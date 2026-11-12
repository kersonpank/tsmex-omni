import React, { Suspense, useRef, useState } from 'react';
import clsx from 'clsx';
import { OsButton } from '../../ui/kit';
import { osFieldClass } from '../../ui/Sheet';

const Scanner = React.lazy(() => import('../../ui/Scanner'));

export type ScanFeedback = { tone: 'ok' | 'warn' | 'bad'; text: string } | null;

/** Campo de leitura da conferência: leitor USB/teclado (Enter) ou câmera. Devolve o texto cru ao pai. */
const ConferenceScan: React.FC<{
    onCode: (code: string) => Promise<void> | void;
    feedback: ScanFeedback;
    conferred: number;
    total: number;
}> = ({ onCode, feedback, conferred, total }) => {
    const [text, setText] = useState('');
    const [camera, setCamera] = useState(false);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const submit = async (code: string) => {
        const value = code.trim();
        if (!value || busy) return;
        setBusy(true);
        setText('');
        try {
            await onCode(value);
        } finally {
            setBusy(false);
            inputRef.current?.focus();
        }
    };

    return (
        <div className="mb-4 rounded-xl border-2 border-brand-500/40 bg-white p-3 dark:bg-tower-900">
            <div className="mb-2 flex items-baseline justify-between">
                <p className="text-[13px] font-bold text-tower-700 dark:text-tower-200">Leia a etiqueta, a NF-e ou digite o número</p>
                <p className="font-display text-[15px] font-extrabold text-tower-900 dark:text-white" aria-label="conferidos">
                    {conferred}/{total}
                </p>
            </div>
            <form
                className="flex gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit(text);
                }}
            >
                <input
                    ref={inputRef}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    autoComplete="off"
                    aria-label="Código lido"
                    placeholder="Pedido, NF ou chave de 44 dígitos"
                    className={clsx(osFieldClass, 'min-w-0 flex-1')}
                />
                <OsButton type="button" variant="secondary" onClick={() => setCamera(true)} aria-label="Ler com a câmera" className="!px-4">
                    Câmera
                </OsButton>
            </form>
            {feedback ? (
                <p
                    role="status"
                    className={clsx(
                        'mt-2.5 rounded-lg p-2.5 text-[13px] font-bold',
                        feedback.tone === 'ok' && 'bg-emerald-600/12 text-emerald-700 dark:text-emerald-300',
                        feedback.tone === 'warn' && 'bg-brand-yellow-400/25 text-[#6b5900] dark:text-brand-yellow-400',
                        feedback.tone === 'bad' && 'bg-brand-red-500/12 text-brand-red-600 dark:text-brand-red-400',
                    )}
                >
                    {feedback.text}
                </p>
            ) : null}
            {camera ? (
                <Suspense fallback={null}>
                    <Scanner
                        onClose={() => setCamera(false)}
                        onCode={(code) => {
                            setCamera(false);
                            void submit(code);
                        }}
                    />
                </Suspense>
            ) : null}
        </div>
    );
};

export default ConferenceScan;
