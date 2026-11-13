import React from 'react';
import { Link } from 'react-router-dom';
import { IconArrowUpRight } from '../../ui/icons';
import { Panel } from '../../ui/kit';

interface Shortcut {
    title: string;
    text: string;
    links: Array<{ label: string; to: string }>;
}

export const CadastrosTab: React.FC = () => {
    const shortcuts: Shortcut[] = [
        { title: 'Tipos de veículo', text: 'Capacidade de peso, volume e valor de cada tipo de veículo da frota.', links: [{ label: 'Abrir Tipos de veículo', to: '/gestao?cat=fleet' }] },
        {
            title: 'Motoristas e transportadores',
            text: 'Cadastro completo: dados, convite de acesso e vínculo com o veículo. Aprovar ou recusar já se faz na aba Transportadores.',
            links: [{ label: 'Abrir cadastro completo', to: '/gestao?cat=transport&sub=motoristas' }],
        },
        {
            title: 'Rotas e tarifas',
            text: 'Rotas entre hubs e as tabelas de preço usadas na cotação.',
            links: [
                { label: 'Rotas', to: '/gestao?cat=transport&sub=rotas' },
                { label: 'Tarifas', to: '/gestao?cat=commercial&sub=tarifas' },
            ],
        },
    ];

    return (
        <Panel title="Cadastros" hint="Hubs, Pessoas e Clientes já se cadastram nas abas ao lado. Aqui ficam só os atalhos do que continua na gestão clássica." padded={false}>
            <ul className="flex flex-col">
                {shortcuts.map((item) => (
                    <li key={item.title} className="gx-hair-b flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 last:border-b-0">
                        <div className="min-w-0 flex-1 basis-[280px]">
                            <p className="font-semibold">{item.title}</p>
                            <p className="gx-muted text-[13.5px]">{item.text}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {item.links.map((link) => (
                                <Link key={link.to} to={link.to} className="gx-btn gx-btn-soft gx-btn-sm">
                                    {link.label}
                                    <IconArrowUpRight size={14} />
                                </Link>
                            ))}
                        </div>
                    </li>
                ))}
            </ul>
        </Panel>
    );
};
