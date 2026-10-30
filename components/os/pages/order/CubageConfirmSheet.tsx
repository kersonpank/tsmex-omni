import React from 'react';
import { OsButton } from '../../ui/kit';
import OsSheet from '../../ui/Sheet';

/**
 * A cubagem é necessária, mas nunca trava a operação: o operador decide.
 * "Informar cubagem" é a ação primária; seguir sem ela é explícito e secundário.
 */
const CubageConfirmSheet: React.FC<{
    title: string;
    body: string;
    informLabel?: string;
    proceedLabel: string;
    onInform: () => void;
    onProceed: () => void;
    onClose: () => void;
}> = ({ title, body, informLabel = 'Informar cubagem', proceedLabel, onInform, onProceed, onClose }) => (
    <OsSheet
        title={title}
        onClose={onClose}
        footer={
            <div className="flex flex-col gap-2">
                <OsButton full onClick={onInform}>
                    {informLabel}
                </OsButton>
                <OsButton full variant="secondary" onClick={onProceed}>
                    {proceedLabel}
                </OsButton>
            </div>
        }
    >
        <p className="text-[14px] text-tower-700 dark:text-tower-200">{body}</p>
    </OsSheet>
);

export default CubageConfirmSheet;
