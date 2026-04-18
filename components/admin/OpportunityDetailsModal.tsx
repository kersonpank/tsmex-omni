import React, { useState, useEffect } from 'react';
import { opportunitiesApi, chatMessagesApi } from '../../lib/api';
import type { Opportunity } from '../../types/index';

interface OpportunityDetailsModalProps {
    opportunity: Opportunity;
    onClose: () => void;
    onConvert: (id: string) => void;
}

const OpportunityDetailsModal: React.FC<OpportunityDetailsModalProps> = ({
    opportunity: initialOpportunity,
    onClose,
    onConvert,
}) => {
    const [opportunity, setOpportunity] = useState(initialOpportunity);
    const [chatMessages, setChatMessages] = useState<any[]>([]);
    const [loadingChat, setLoadingChat] = useState(false);
    const [activeTab, setActiveTab] = useState<'general' | 'quote' | 'collection' | 'chat' | 'history'>('general');

    useEffect(() => {
        // Load full opportunity data
        loadOpportunityData();
        
        // Load chat messages if source is CHAT
        if (opportunity.source === 'CHAT' && opportunity.sessionId) {
            loadChatMessages(opportunity.sessionId);
        }
    }, [initialOpportunity.id]);

    const loadOpportunityData = async () => {
        try {
            const res = await opportunitiesApi.getById(opportunity.id);
            setOpportunity((res as any)?.data || opportunity);
        } catch (err) {
            console.error('Erro ao carregar dados da oportunidade:', err);
        }
    };

    const loadChatMessages = async (sessionId: string) => {
        try {
            setLoadingChat(true);
            const res = await chatMessagesApi.getBySession(sessionId);
            setChatMessages((res as any)?.data?.messages || []);
        } catch (err) {
            console.error('Erro ao carregar mensagens do chat:', err);
        } finally {
            setLoadingChat(false);
        }
    };

    const statusColors: Record<string, string> = {
        QUOTE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200',
        FOLLOW_UP: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
        COLLECTION_REQUESTED: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200',
        CONVERTED: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200',
        LOST: 'bg-tower-100 text-tower-500 dark:bg-tower-700 dark:text-tower-400',
    };

    const parseDimensions = (dimensions: string | null | undefined): Array<{ qty: number; altura: number; largura: number; comprimento: number }> => {
        if (!dimensions) return [];
        try {
            const parsed = JSON.parse(dimensions);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-tower-800 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-tower-200 dark:border-tower-700"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="border-b border-tower-200 dark:border-tower-700 p-6 flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <span className="text-xs font-bold text-tower-400 dark:text-tower-500">#{opportunity.id.slice(0, 8)}</span>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${statusColors[opportunity.stage] || 'bg-tower-100'}`}>
                                {opportunity.stage}
                            </span>
                            {opportunity.source === 'ENTRADA' && (
                                <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-200 text-amber-900">
                                    Concluir cadastro do cliente
                                </span>
                            )}
                            {opportunity.quotedPrice && (
                                <span className="text-lg font-bold text-brand-600">
                                    R$ {opportunity.quotedPrice.toLocaleString()}
                                </span>
                            )}
                        </div>
                        <h2 className="text-xl font-bold text-tower-900 dark:text-tower-100">
                            {opportunity.origin || 'N/A'} → {opportunity.destination || 'N/A'}
                        </h2>
                        <p className="text-sm text-tower-500 dark:text-tower-400 mt-1">
                            Criado em {new Date(opportunity.createdAt).toLocaleString('pt-BR')} • via {opportunity.source}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-tower-400 hover:text-tower-600 text-2xl font-bold"
                    >
                        ×
                    </button>
                </div>

                {/* Tabs */}
                <div className="border-b border-tower-200 flex overflow-x-auto">
                    {[
                        { id: 'general', label: 'Geral', icon: '📋' },
                        { id: 'quote', label: 'Cotação', icon: '💰' },
                        ...(opportunity.needsCollection || (opportunity.collectionData && typeof opportunity.collectionData === 'object') ? [{ id: 'collection', label: 'Coleta', icon: '🚛' }] : []),
                        ...(opportunity.source === 'CHAT' ? [{ id: 'chat', label: 'Chat', icon: '💬' }] : []),
                        { id: 'history', label: 'Histórico', icon: '📜' },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${
                                activeTab === tab.id
                                    ? 'border-brand-600 text-brand-600'
                                    : 'border-transparent text-tower-500 hover:text-tower-700'
                            }`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'general' && (
                        <div className="space-y-6">
                            {(opportunity as any).source === 'ENTRADA' && (opportunity as any).orders?.length > 0 && (
                                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                                    <h3 className="text-sm font-bold text-amber-800 dark:text-amber-200 mb-2">Pedido(s) vinculado(s)</h3>
                                    <div className="space-y-2">
                                        {((opportunity as any).orders as { id: string; status: string }[]).map((ord: { id: string; status: string }) => (
                                            <div key={ord.id} className="text-sm text-amber-700 dark:text-amber-300">
                                                Pedido <span className="font-mono font-medium">#{ord.id.slice(0, 8)}</span> — Status: {ord.status}
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">Encontre em Transporte → Entrada</p>
                                </div>
                            )}
                            {opportunity.collectionData && typeof opportunity.collectionData === 'object' && (
                                <div className="bg-tower-50 dark:bg-tower-800/50 rounded-xl p-4 border border-tower-200 dark:border-tower-600">
                                    <h3 className="text-sm font-bold text-tower-700 dark:text-tower-200 mb-3">Dados da coleta / pedido</h3>
                                    <div className="grid md:grid-cols-2 gap-4 text-sm">
                                        {(opportunity.collectionData as any).address && (
                                            <div>
                                                <span className="text-xs text-tower-500 uppercase font-bold">Endereço</span>
                                                <div className="text-tower-900 dark:text-tower-100 mt-0.5">
                                                    {(opportunity.collectionData as any).address.street}, {(opportunity.collectionData as any).address.number}
                                                    {(opportunity.collectionData as any).address.city && (
                                                        <> — {(opportunity.collectionData as any).address.city}/{(opportunity.collectionData as any).address.state}</>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {((opportunity.collectionData as any).commodity || opportunity.commodity) && (
                                            <div>
                                                <span className="text-xs text-tower-500 uppercase font-bold">Mercadoria</span>
                                                <div className="text-tower-900 dark:text-tower-100 mt-0.5">{(opportunity.collectionData as any).commodity || opportunity.commodity}</div>
                                            </div>
                                        )}
                                        {((opportunity.collectionData as any).weight != null || opportunity.weight != null) && (
                                            <div>
                                                <span className="text-xs text-tower-500 uppercase font-bold">Peso</span>
                                                <div className="text-tower-900 dark:text-tower-100 mt-0.5">
                                                    {((opportunity.collectionData as any).weight ?? opportunity.weight)} kg
                                                </div>
                                            </div>
                                        )}
                                        {((opportunity.collectionData as any).nfValue != null || opportunity.nfValue != null) && (
                                            <div>
                                                <span className="text-xs text-tower-500 uppercase font-bold">Valor NF</span>
                                                <div className="text-tower-900 dark:text-tower-100 mt-0.5">
                                                    R$ {(((opportunity.collectionData as any).nfValue ?? opportunity.nfValue) as number).toLocaleString()}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-1">Origem</label>
                                    <div className="text-tower-900 font-medium">{opportunity.origin || 'Não informado'}</div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-1">Destino</label>
                                    <div className="text-tower-900 font-medium">{opportunity.destination || 'Não informado'}</div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-1">CNPJ Remetente</label>
                                    <div className="text-tower-900 font-medium">{opportunity.cpfCnpjSender || 'Não informado'}</div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-1">CNPJ Destinatário</label>
                                    <div className="text-tower-900 font-medium">{opportunity.cpfCnpjReceiver || 'Não informado'}</div>
                                </div>
                                {opportunity.cpfCnpjTransportadora && (
                                    <div>
                                        <label className="block text-xs font-bold text-tower-400 uppercase mb-1">CNPJ Transportadora</label>
                                        <div className="text-tower-900 font-medium">{opportunity.cpfCnpjTransportadora}</div>
                                    </div>
                                )}
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-1">Mercadoria</label>
                                    <div className="text-tower-900 font-medium">{opportunity.commodity || 'Não informado'}</div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-1">Peso</label>
                                    <div className="text-tower-900 font-medium">{opportunity.weight ? `${opportunity.weight}kg` : 'Não informado'}</div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-1">Volumes</label>
                                    <div className="text-tower-900 font-medium">{opportunity.volumes || 'Não informado'}</div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-1">Valor da NF</label>
                                    <div className="text-tower-900 font-medium">
                                        {opportunity.nfValue ? `R$ ${opportunity.nfValue.toLocaleString()}` : 'Não informado'}
                                    </div>
                                </div>
                                {opportunity.freightTerm && (
                                    <div>
                                        <label className="block text-xs font-bold text-tower-400 uppercase mb-1">Termo de Frete</label>
                                        <div className="text-tower-900 font-medium">{opportunity.freightTerm}</div>
                                    </div>
                                )}
                            </div>

                            {opportunity.dimensions && (
                                <div>
                                    <label className="block text-xs font-bold text-tower-400 uppercase mb-2">Dimensões</label>
                                    <div className="space-y-2">
                                        {parseDimensions(opportunity.dimensions).map((dim, idx) => (
                                            <div key={idx} className="bg-tower-50 rounded-lg p-3 text-sm">
                                                {dim.qty} vol: {dim.altura}cm × {dim.largura}cm × {dim.comprimento}cm
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'quote' && (
                        <div className="space-y-6">
                            {opportunity.quotedPrice ? (
                                <>
                                    <div className="bg-brand-50 border border-brand-200 rounded-xl p-6">
                                        <div className="text-2xl font-bold text-brand-700 mb-2">
                                            R$ {opportunity.quotedPrice.toLocaleString()}
                                        </div>
                                        <div className="text-sm text-brand-600">Valor Total Cotado</div>
                                    </div>

                                    {opportunity.quoteBreakdown && typeof opportunity.quoteBreakdown === 'object' && (
                                        <div className="space-y-3">
                                            <h3 className="font-bold text-tower-800">Detalhamento</h3>
                                            {Object.entries(opportunity.quoteBreakdown as any).map(([key, value]: [string, any]) => (
                                                <div key={key} className="flex justify-between items-center p-3 bg-tower-50 rounded-lg">
                                                    <span className="text-sm text-tower-600 capitalize">{key}</span>
                                                    <span className="text-sm font-bold text-tower-900">
                                                        {typeof value === 'number' ? `R$ ${value.toLocaleString()}` : String(value)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {opportunity.validUntil && (
                                        <div className="text-sm text-tower-500">
                                            Válido até: {new Date(opportunity.validUntil).toLocaleString('pt-BR')}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-center py-8 text-tower-400">
                                    Cotação ainda não calculada
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'collection' && (opportunity.needsCollection || (opportunity.collectionData && typeof opportunity.collectionData === 'object')) && (
                        <div className="space-y-6">
                            {opportunity.collectionData && typeof opportunity.collectionData === 'object' ? (
                                <>
                                    {opportunity.collectionData.contractorCnpj && (
                                        <div>
                                            <label className="block text-xs font-bold text-tower-400 uppercase mb-1">CNPJ Contratante</label>
                                            <div className="text-tower-900 font-medium">{opportunity.collectionData.contractorCnpj}</div>
                                        </div>
                                    )}

                                    {opportunity.collectionData.senderContacts && Array.isArray(opportunity.collectionData.senderContacts) && (
                                        <div>
                                            <label className="block text-xs font-bold text-tower-400 uppercase mb-2">Contatos do Remetente</label>
                                            <div className="space-y-3">
                                                {opportunity.collectionData.senderContacts.map((contact: any, idx: number) => (
                                                    <div key={idx} className="bg-tower-50 rounded-lg p-4">
                                                        <div className="font-medium text-tower-900">{contact.name}</div>
                                                        <div className="text-sm text-tower-600">{contact.phone}</div>
                                                        {contact.email && <div className="text-sm text-tower-600">{contact.email}</div>}
                                                        {contact.availableTime && <div className="text-sm text-tower-500">Horário: {contact.availableTime}</div>}
                                                        {contact.notes && <div className="text-sm text-tower-500 mt-2">{contact.notes}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {opportunity.collectionData.address && (
                                        <div>
                                            <label className="block text-xs font-bold text-tower-400 uppercase mb-2">Endereço de Coleta</label>
                                            <div className="bg-tower-50 rounded-lg p-4 space-y-1 text-sm">
                                                <div className="font-medium text-tower-900">
                                                    {opportunity.collectionData.address.street}, {opportunity.collectionData.address.number}
                                                </div>
                                                {opportunity.collectionData.address.complement && (
                                                    <div className="text-tower-600">Complemento: {opportunity.collectionData.address.complement}</div>
                                                )}
                                                <div className="text-tower-600">
                                                    {opportunity.collectionData.address.neighborhood} - {opportunity.collectionData.address.city}/{opportunity.collectionData.address.state}
                                                </div>
                                                <div className="text-tower-600">CEP: {opportunity.collectionData.address.cep}</div>
                                                {opportunity.collectionData.address.referencePoint && (
                                                    <div className="text-tower-500 mt-2 italic">
                                                        Ponto de referência: {opportunity.collectionData.address.referencePoint}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-4">
                                        {opportunity.collectionData.needsHelper && (
                                            <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-sm font-medium">
                                                Precisa de ajudante
                                            </span>
                                        )}
                                        {opportunity.collectionData.needsLoading && (
                                            <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
                                                Necessário carregar
                                            </span>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="text-center py-8 text-tower-400">
                                    Dados de coleta ainda não preenchidos
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'chat' && opportunity.source === 'CHAT' && (
                        <div className="space-y-4">
                            {loadingChat ? (
                                <div className="text-center py-8 text-tower-400">Carregando mensagens...</div>
                            ) : chatMessages.length > 0 ? (
                                <div className="space-y-4">
                                    {chatMessages.map((msg: any) => (
                                        <div
                                            key={msg.id}
                                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                        >
                                            <div
                                                className={`max-w-[80%] rounded-2xl p-4 ${
                                                    msg.role === 'user'
                                                        ? 'bg-brand-600 text-white'
                                                        : 'bg-tower-100 text-tower-900'
                                                }`}
                                            >
                                                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                                                {msg.attachments && msg.attachments.length > 0 && (
                                                    <div className="mt-2 space-y-2">
                                                        {msg.attachments.map((att: any, idx: number) => (
                                                            <div key={idx} className="text-xs opacity-80">
                                                                {att.type === 'IMAGE' && (
                                                                    <img src={att.fileUrl} alt={att.fileName} className="max-w-full rounded-lg mt-2" />
                                                                )}
                                                                {att.type !== 'IMAGE' && (
                                                                    <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="underline">
                                                                        📎 {att.fileName}
                                                                    </a>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className={`text-xs mt-2 ${msg.role === 'user' ? 'text-brand-100' : 'text-tower-500'}`}>
                                                    {new Date(msg.createdAt).toLocaleString('pt-BR')}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-tower-400">
                                    Nenhuma mensagem encontrada
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="space-y-4">
                            <div className="bg-tower-50 rounded-lg p-4">
                                <div className="text-sm font-medium text-tower-900 mb-1">Criado</div>
                                <div className="text-xs text-tower-600">
                                    {new Date(opportunity.createdAt).toLocaleString('pt-BR')}
                                </div>
                            </div>
                            {opportunity.updatedAt && opportunity.updatedAt !== opportunity.createdAt && (
                                <div className="bg-tower-50 rounded-lg p-4">
                                    <div className="text-sm font-medium text-tower-900 mb-1">Última atualização</div>
                                    <div className="text-xs text-tower-600">
                                        {new Date(opportunity.updatedAt).toLocaleString('pt-BR')}
                                    </div>
                                </div>
                            )}
                            {opportunity.matchedDemandId && (
                                <div className="bg-brand-50 border border-brand-200 rounded-lg p-4">
                                    <div className="text-sm font-medium text-brand-900 mb-1">Convertida para Demanda</div>
                                    <div className="text-xs text-brand-700">
                                        ID: {opportunity.matchedDemandId}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="border-t border-tower-200 p-6 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-tower-600 font-medium hover:bg-tower-100 rounded-lg"
                    >
                        Fechar
                    </button>
                    {opportunity.stage === 'QUOTE' && opportunity.completeness === 'COMPLETE' && (
                        <button
                            onClick={() => {
                                onConvert(opportunity.id);
                                onClose();
                            }}
                            className="px-4 py-2 bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700"
                        >
                            Gerar Demanda
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OpportunityDetailsModal;
