import React, { useState } from 'react';

const KEY = 'tsmos.excecoes.intro.dispensada';

const dismissed = (): boolean => {
    try {
        return window.localStorage.getItem(KEY) === '1';
    } catch {
        return false;
    }
};

/** Explicação da estação, em duas linhas; o operador pode dispensar (lembrado no aparelho). */
const ExceptionsIntro: React.FC = () => {
    const [hidden, setHidden] = useState(dismissed);
    if (hidden) return null;
    return (
        <div className="mb-3 rounded-xl bg-brand-500/8 p-3.5 text-[13px] leading-relaxed text-brand-800 dark:bg-brand-500/15 dark:text-brand-100">
            <p>
                Aqui aparece o que travou e precisa de alguém: carga parada há dias, pedido sem rota, divergência na chegada, documento fiscal que não fechou.
                Resolva pelo botão de cada cartão.
            </p>
            <button
                type="button"
                className="mt-1 min-h-11 font-bold underline"
                onClick={() => {
                    try {
                        window.localStorage.setItem(KEY, '1');
                    } catch {
                        /* sem storage: some só nesta visita */
                    }
                    setHidden(true);
                }}
            >
                Entendi, não mostrar de novo
            </button>
        </div>
    );
};

export default ExceptionsIntro;
