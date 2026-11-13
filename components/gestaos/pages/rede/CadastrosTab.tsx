import React from 'react';
import { Link } from 'react-router-dom';
import { useOperationsSummary } from '../../lib/data';
import { num } from '../../lib/format';
import { IconArrowUpRight } from '../../ui/icons';
import { Panel } from '../../ui/kit';

interface Shortcut {
    title: string;
    text: string;
    links: Array<{ label: string; to: string }>;
    note?: string;
}

export const CadastrosTab: React.FC = () => {
    const summary = useOperationsSummary();
    const clients = summary.data?.clientes;

    const shortcuts: Shortcut[] = [
        { title: 'Pessoas', text: 'Cadastro único de quem existe na operação: empresas e pessoas, com documento e endereço.', links: [{ label: 'Abrir Pessoas', to: '/gestao?cat=pessoas' }] },
        {
            title: 'Clientes',
            text: 'Contas dos embarcadores, seus CNPJs e usuários.',
            links: [{ label: 'Abrir Clientes', to: '/gestao?cat=commercial&sub=clientes' }],
            note: clients ? `${num(clients.total)} no total · ${num(clients.novos7d)} novos em 7 dias · ${num(clients.novos30d)} em 30 dias` : undefined,
        },
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
        { title: 'Hubs: cadastro e operadores', text: 'Dados da filial, cobertura, capacidade e quem opera cada hub.', links: [{ label: 'Abrir cadastro de hubs', to: '/gestao?cat=transport&sub=hubs' }] },
    ];

    return (
        <Panel title="Cadastros" hint="O cadastro continua na gestão clássica. Aqui ficam só os atalhos, para a rotina da torre não precisar procurar." padded={false}>
            <ul className="flex flex-col">
                {shortcuts.map((item) => (
                    <li key={item.title} className="gx-hair-b flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 last:border-b-0">
                        <div className="min-w-0 flex-1 basis-[280px]">
                            <p className="font-semibold">{item.title}</p>
                            <p className="gx-muted text-[13.5px]">{item.text}</p>
                            {item.note ? <p className="gx-soft mt-1 text-[13px]">{item.note}</p> : null}
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
