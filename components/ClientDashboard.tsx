import React, { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { accountsApi, demandsApi, opportunitiesApi, ordersApi } from '../lib/api';
import type { Demand } from '../types/index';
import AddCNPJModal from './client/AddCNPJModal';
import AddUserModal from './client/AddUserModal';
import AddContactModal from './client/AddContactModal';

// ==================== TYPES ====================

interface Account {
    id: string;
    name: string;
    accountType: string;
    companies: AccountCompany[];
    contacts: AccountContact[];
    users: any[];
}

interface AccountCompany {
    id: string;
    cnpj: string;
    legalName: string;
    tradeName?: string;
    city?: string;
    state?: string;
    isPrimary: boolean;
    _count?: { clients: number };
}

interface AccountContact {
    id: string;
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    isPrimary: boolean;
}

interface AccountUser {
    id: string;
    email: string;
    role: string;
    active: boolean;
    createdAt: string;
    client?: {
        id: string;
        companyName: string;
        document: string;
        accountCompany?: {
            id: string;
            cnpj: string;
            legalName: string;
        };
    };
}

interface AccountStats {
    totalDemands: number;
    pending: number;
    quoted: number;
    inTransit: number;
    delivered: number;
    totalValue: number;
    companiesCount: number;
    usersCount: number;
    contactsCount: number;
}

type TabType = 'overview' | 'demands' | 'companies' | 'users' | 'contacts' | 'pricing';

// ==================== STATUS LABELS ====================

const statusLabels: Record<string, string> = {
    PENDING: 'Pendente',
    QUOTED: 'Cotado',
    APPROVED: 'Aprovado',
    ASSIGNED: 'Em Manifesto',
    COLLECTED: 'Coletado',
    IN_TRANSIT: 'Em Trânsito',
    AT_HUB: 'No HUB',
    OUT_FOR_DELIVERY: 'Saiu para Entrega',
    DELIVERED: 'Entregue',
    CANCELLED: 'Cancelado',
};

const statusColors: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
    QUOTED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200',
    APPROVED: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200',
    ASSIGNED: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200',
    COLLECTED: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-200',
    IN_TRANSIT: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200',
    AT_HUB: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200',
    OUT_FOR_DELIVERY: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200',
    DELIVERED: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200',
};

// ==================== COMPONENT ====================

const ClientDashboard: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const [account, setAccount] = useState<Account | null>(null);
    const [stats, setStats] = useState<AccountStats | null>(null);
    const [demands, setDemands] = useState<Demand[]>([]);
    const [opportunities, setOpportunities] = useState<any[]>([]);
    const [orders, setOrders] = useState<any[]>([]);
    const [unifiedItems, setUnifiedItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Modals
    const [showAddCNPJ, setShowAddCNPJ] = useState(false);
    const [showAddUser, setShowAddUser] = useState(false);
    const [showAddContact, setShowAddContact] = useState(false);
    
    // Filters
    const [selectedCompany, setSelectedCompany] = useState<string>('all');
    const [demandStatusFilter, setDemandStatusFilter] = useState<string>('all');

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (activeTab === 'demands') {
            loadDemands();
            loadOpportunities();
            loadOrders();
        }
    }, [activeTab, selectedCompany, demandStatusFilter]);

    // Load demands, opportunities and orders on mount if overview tab
    useEffect(() => {
        if (activeTab === 'overview') {
            loadDemands();
            loadOpportunities();
            loadOrders();
        }
    }, [activeTab, account]);

    useEffect(() => {
        if (account?.id) {
            loadDemands();
            loadOpportunities();
            loadOrders();
        }
    }, [account?.id]);

    const loadData = async () => {
        try {
            setLoading(true);
            setError(null);
            
            const [accountRes, statsRes] = await Promise.all([
                accountsApi.getMe(),
                accountsApi.getStats(),
            ]);
            
            setAccount(accountRes.data);
            setStats(statsRes.data);
        } catch (err: any) {
            console.error('Erro ao carregar dados:', err);
            setError(err.response?.data?.error || 'Erro ao carregar dados da conta');
        } finally {
            setLoading(false);
        }
    };

    const loadDemands = async () => {
        try {
            const response = await demandsApi.list({ limit: 100 });
            let filtered = response.data;
            
            // Filter by company if selected
            if (selectedCompany !== 'all' && account) {
                const company = account.companies.find(c => c.id === selectedCompany);
                if (company) {
                    // Filter demands by CNPJ (would need to check client document)
                    // For now, show all demands
                }
            }
            
            // Filter by status
            if (demandStatusFilter !== 'all') {
                filtered = filtered.filter(d => d.status === demandStatusFilter);
            }
            
            setDemands(filtered);
        } catch (err: any) {
            console.error('Erro ao carregar demandas:', err);
        }
    };

    const loadOpportunities = async () => {
        try {
            if (!account?.id) return;
            const response = await opportunitiesApi.list({ accountId: account.id, limit: 50 });
            setOpportunities(response.data || []);
            updateUnifiedItems();
        } catch (err: any) {
            console.error('Erro ao carregar oportunidades:', err);
        }
    };

    const loadOrders = async () => {
        try {
            if (!account?.id) return;
            const response = await ordersApi.list({ accountId: account.id, limit: 50 });
            setOrders(response.data || []);
            updateUnifiedItems();
        } catch (err: any) {
            console.error('Erro ao carregar pedidos:', err);
        }
    };

    const updateUnifiedItems = () => {
        const unified: any[] = [];
        
        // Add opportunities (cotações pendentes)
        opportunities.forEach(opp => {
            if (opp.stage !== 'CONVERTED' && opp.stage !== 'LOST') {
                unified.push({
                    id: opp.id,
                    type: 'OPPORTUNITY',
                    origin: opp.origin || 'N/A',
                    destination: opp.destination || 'N/A',
                    status: opp.stage,
                    quotedPrice: opp.quotedPrice,
                    createdAt: opp.createdAt,
                    commodity: opp.commodity,
                    weight: opp.weight,
                    volumes: opp.volumes,
                    nfValue: opp.nfValue,
                    needsCollection: opp.needsCollection,
                });
            }
        });
        
        // Add demands
        demands.forEach(demand => {
            unified.push({
                id: demand.id,
                type: 'DEMAND',
                origin: demand.origin,
                destination: demand.destination,
                status: demand.status,
                quotedPrice: demand.quotedPrice,
                createdAt: demand.createdAt,
                commodity: demand.commodity,
                weight: demand.weight,
                volumes: demand.units,
                nfValue: demand.nfValue,
                nfNumber: demand.nfNumber,
            });
        });
        
        // Add orders
        orders.forEach(order => {
            unified.push({
                id: order.id,
                type: 'ORDER',
                origin: order.demand?.origin || 'N/A',
                destination: order.demand?.destination || 'N/A',
                status: order.status,
                quotedPrice: order.demand?.quotedPrice,
                createdAt: order.createdAt,
                commodity: order.demand?.commodity,
                weight: order.demand?.weight,
                volumes: order.demand?.units,
                nfValue: order.demand?.nfValue,
                nfNumber: order.nfNumber || order.demand?.nfNumber,
                demandId: order.demandId,
            });
        });
        
        // Sort by creation date (newest first)
        unified.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
        setUnifiedItems(unified);
    };

    useEffect(() => {
        updateUnifiedItems();
    }, [demands, opportunities, orders]);

    const handleAddCNPJ = async (data: any) => {
        try {
            await accountsApi.addCompany(data);
            setShowAddCNPJ(false);
            loadData();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Erro ao adicionar CNPJ');
        }
    };

    const handleAddUser = async (data: any) => {
        try {
            await accountsApi.addUser(data);
            setShowAddUser(false);
            loadData();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Erro ao adicionar usuário');
        }
    };

    const handleAddContact = async (data: any) => {
        try {
            await accountsApi.addContact(data);
            setShowAddContact(false);
            loadData();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Erro ao adicionar contato');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-tower-500 dark:text-tower-400">Carregando...</p>
                </div>
            </div>
        );
    }

    if (error || !account) {
        return (
            <div className="max-w-7xl mx-auto py-8 px-4">
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-2xl p-8 text-center">
                    <p className="text-red-600 dark:text-red-300 font-medium mb-4">{error || 'Conta não encontrada'}</p>
                    <button
                        onClick={loadData}
                        className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
                    >
                        Tentar Novamente
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-tower-900 dark:text-tower-100">{account.name}</h1>
                    <p className="text-tower-500 dark:text-tower-400 text-sm">Dashboard do Cliente</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <RouterLink
                        to="/form/cotacao"
                        className="px-4 py-2 bg-brand-600 text-white font-bold rounded-xl text-sm hover:bg-brand-700 transition-all shadow-sm"
                    >
                        📋 Cotação
                    </RouterLink>
                    <RouterLink
                        to="/form/coleta"
                        className="px-4 py-2 bg-tower-100 dark:bg-tower-700 text-tower-700 dark:text-tower-200 font-bold rounded-xl text-sm hover:bg-tower-200 dark:hover:bg-tower-600 transition-all"
                    >
                        🚛 Coleta
                    </RouterLink>
                    <RouterLink
                        to="/chat/demo"
                        className="px-4 py-2 bg-tower-100 dark:bg-tower-700 text-tower-700 dark:text-tower-200 font-bold rounded-xl text-sm hover:bg-tower-200 dark:hover:bg-tower-600 transition-all"
                    >
                        💬 Chat
                    </RouterLink>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-tower-200 dark:border-tower-700 mb-8 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === 'overview'
                            ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                            : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-300'
                    }`}
                >
                    📊 Visão Geral
                </button>
                <button
                    onClick={() => setActiveTab('demands')}
                    className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === 'demands'
                            ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                            : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-300'
                    }`}
                >
                    📦 Minhas Demandas
                </button>
                <button
                    onClick={() => setActiveTab('companies')}
                    className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === 'companies'
                            ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                            : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-300'
                    }`}
                >
                    🏢 CNPJs
                </button>
                <button
                    onClick={() => setActiveTab('users')}
                    className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === 'users'
                            ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                            : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-300'
                    }`}
                >
                    👥 Usuários
                </button>
                <button
                    onClick={() => setActiveTab('contacts')}
                    className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === 'contacts'
                            ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                            : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-300'
                    }`}
                >
                    📞 Contatos
                </button>
                <button
                    onClick={() => setActiveTab('pricing')}
                    className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === 'pricing'
                            ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                            : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-300'
                    }`}
                >
                    💰 Tabelas de Preço
                </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'overview' && stats && (
                <div className="space-y-6">
                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 p-4 rounded-xl shadow-sm">
                            <span className="block text-[10px] text-tower-400 dark:text-tower-500 font-bold uppercase mb-1">Total Demandas</span>
                            <span className="text-2xl font-bold text-tower-900 dark:text-tower-100">{stats.totalDemands}</span>
                        </div>
                        <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 p-4 rounded-xl shadow-sm">
                            <span className="block text-[10px] text-tower-400 dark:text-tower-500 font-bold uppercase mb-1">Em Trânsito</span>
                            <span className="text-2xl font-bold text-brand-600 dark:text-brand-400">{stats.inTransit}</span>
                        </div>
                        <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 p-4 rounded-xl shadow-sm">
                            <span className="block text-[10px] text-tower-400 dark:text-tower-500 font-bold uppercase mb-1">Pendentes</span>
                            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.pending}</span>
                        </div>
                        <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 p-4 rounded-xl shadow-sm">
                            <span className="block text-[10px] text-tower-400 dark:text-tower-500 font-bold uppercase mb-1">Faturado</span>
                            <span className="text-2xl font-bold text-brand-600 dark:text-brand-400">R$ {stats.totalValue.toLocaleString()}</span>
                        </div>
                    </div>

                    {/* Ações rápidas */}
                    <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-6">
                        <h3 className="text-sm font-bold text-tower-400 dark:text-tower-500 uppercase mb-4">Ações rápidas</h3>
                        <div className="flex flex-wrap gap-3">
                            <RouterLink
                                to="/form/cotacao"
                                className="px-4 py-3 bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-medium rounded-xl hover:bg-brand-100 dark:hover:bg-brand-900/60 transition-colors"
                            >
                                📋 Cotação (várias de uma vez)
                            </RouterLink>
                            <RouterLink
                                to="/form/coleta"
                                className="px-4 py-3 bg-tower-100 dark:bg-tower-700 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-200 dark:hover:bg-tower-600 transition-colors"
                            >
                                🚛 Solicitar coleta
                            </RouterLink>
                            <RouterLink
                                to="/chat/demo"
                                className="px-4 py-3 bg-tower-100 dark:bg-tower-700 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-200 dark:hover:bg-tower-600 transition-colors"
                            >
                                💬 Chat
                            </RouterLink>
                        </div>
                    </div>

                    {/* CNPJs Ativos */}
                    <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-6">
                        <h3 className="text-sm font-bold text-tower-400 dark:text-tower-500 uppercase mb-4">CNPJs Ativos</h3>
                        <div className="flex flex-wrap gap-2">
                            {account.companies.map(company => (
                                <div
                                    key={company.id}
                                    className={`px-3 py-1 rounded-lg text-xs font-medium ${
                                        company.isPrimary
                                            ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-700'
                                            : 'bg-tower-100 dark:bg-tower-700 text-tower-700 dark:text-tower-300'
                                    }`}
                                >
                                    {company.cnpj} {company.isPrimary && '⭐'}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Minhas Demandas (Unificado) */}
                    <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-tower-400 dark:text-tower-500 uppercase">Minhas Demandas</h3>
                            <RouterLink
                                to="#"
                                onClick={() => setActiveTab('demands')}
                                className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
                            >
                                Ver todas →
                            </RouterLink>
                        </div>
                        {unifiedItems.length === 0 ? (
                            <p className="text-tower-400 dark:text-tower-500 text-sm text-center py-4">Nenhuma demanda ainda</p>
                        ) : (
                            <div className="space-y-3">
                                {unifiedItems.slice(0, 5).map((item: any) => (
                                    <div key={item.id} className="flex justify-between items-center p-3 bg-tower-50 dark:bg-tower-700/50 rounded-xl">
                                        <div className="flex-grow">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="text-xs font-bold text-tower-400 dark:text-tower-500">#{item.id.slice(0, 8)}</span>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                    item.type === 'OPPORTUNITY' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200' :
                                                    item.type === 'ORDER' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200' :
                                                    statusColors[item.status] || 'bg-tower-100 text-tower-700 dark:bg-tower-700 dark:text-tower-300'
                                                }`}>
                                                    {item.type === 'OPPORTUNITY' ? 'Cotação' :
                                                     item.type === 'ORDER' ? 'Pedido' :
                                                     statusLabels[item.status] || item.status}
                                                </span>
                                                {item.quotedPrice && (
                                                    <span className="text-xs font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 rounded">
                                                        R$ {item.quotedPrice.toLocaleString()}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-sm font-medium text-tower-700 dark:text-tower-300">
                                                {item.origin} → {item.destination}
                                            </div>
                                            {item.commodity && (
                                                <div className="text-xs text-tower-500 dark:text-tower-400 mt-1">
                                                    {item.commodity} • {item.weight}kg • {item.volumes} vol
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-1 items-end">
                                            {item.type === 'OPPORTUNITY' && item.needsCollection && item.status !== 'COLLECTION_REQUESTED' && (
                                                <RouterLink
                                                    to={`/form/coleta/${item.id}`}
                                                    className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-colors"
                                                >
                                                    🚛 Solicitar Coleta
                                                </RouterLink>
                                            )}
                                            {item.type === 'DEMAND' && (
                                                <RouterLink
                                                    to={`/tracking/${item.id}`}
                                                    className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
                                                >
                                                    Ver tracking →
                                                </RouterLink>
                                            )}
                                            {item.type === 'ORDER' && (
                                                <RouterLink
                                                    to={`/orders/${item.id}`}
                                                    className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
                                                >
                                                    Ver pedido →
                                                </RouterLink>
                                            )}
                                            <span className="text-xs text-tower-400 dark:text-tower-500">
                                                {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'demands' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-4 flex flex-wrap gap-4">
                        <div>
                            <label className="block text-xs font-bold text-tower-400 dark:text-tower-500 uppercase mb-1">CNPJ</label>
                            <select
                                value={selectedCompany}
                                onChange={e => setSelectedCompany(e.target.value)}
                                className="px-3 py-2 border border-tower-200 dark:border-tower-600 rounded-xl text-sm bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
                            >
                                <option value="all">Todos</option>
                                {account.companies.map(c => (
                                    <option key={c.id} value={c.id}>{c.cnpj}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-tower-400 dark:text-tower-500 uppercase mb-1">Status</label>
                            <select
                                value={demandStatusFilter}
                                onChange={e => setDemandStatusFilter(e.target.value)}
                                className="px-3 py-2 border border-tower-200 dark:border-tower-600 rounded-xl text-sm bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
                            >
                                <option value="all">Todos</option>
                                {Object.keys(statusLabels).map(status => (
                                    <option key={status} value={status}>{statusLabels[status]}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Unified Demands List */}
                    {unifiedItems.length === 0 ? (
                        <div className="bg-white dark:bg-tower-800 border-2 border-dashed border-tower-200 dark:border-tower-700 rounded-2xl p-12 text-center text-tower-400 dark:text-tower-500">
                            Nenhuma demanda encontrada.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {unifiedItems
                                .filter(item => {
                                    if (demandStatusFilter !== 'all') {
                                        if (item.type === 'OPPORTUNITY') {
                                            return item.status === demandStatusFilter;
                                        }
                                        return item.status === demandStatusFilter;
                                    }
                                    return true;
                                })
                                .map((item: any) => (
                                <div
                                    key={item.id}
                                    className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-5 hover:shadow-md dark:hover:shadow-tower-900/20 transition-all"
                                >
                                    <div className="flex flex-col md:flex-row justify-between gap-4">
                                        <div className="flex-grow">
                                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                <span className="text-[10px] font-bold text-tower-400 dark:text-tower-500">#{item.id.slice(0, 8)}</span>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                    item.type === 'OPPORTUNITY' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200' :
                                                    item.type === 'ORDER' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200' :
                                                    statusColors[item.status] || 'bg-tower-100 text-tower-700 dark:bg-tower-700 dark:text-tower-300'
                                                }`}>
                                                    {item.type === 'OPPORTUNITY' ? 'Cotação' :
                                                     item.type === 'ORDER' ? 'Pedido' :
                                                     statusLabels[item.status] || item.status}
                                                </span>
                                                {item.quotedPrice && (
                                                    <span className="text-[10px] font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 rounded">
                                                        R$ {item.quotedPrice.toLocaleString()}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-bold text-tower-900 dark:text-tower-100 text-lg mb-2">
                                                {item.origin} <span className="text-tower-300 dark:text-tower-500 mx-1">→</span> {item.destination}
                                            </h3>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                                {item.commodity && (
                                                    <div>
                                                        <span className="block text-tower-400 dark:text-tower-500">Mercadoria</span>
                                                        <span className="font-medium text-tower-700 dark:text-tower-300">{item.commodity}</span>
                                                    </div>
                                                )}
                                                {item.weight && (
                                                    <div>
                                                        <span className="block text-tower-400 dark:text-tower-500">Peso</span>
                                                        <span className="font-medium text-tower-700 dark:text-tower-300">{item.weight}kg</span>
                                                    </div>
                                                )}
                                                {item.nfValue && (
                                                    <div>
                                                        <span className="block text-tower-400 dark:text-tower-500">Valor NF</span>
                                                        <span className="font-medium text-tower-700 dark:text-tower-300">R$ {item.nfValue.toLocaleString()}</span>
                                                    </div>
                                                )}
                                                <div>
                                                    <span className="block text-tower-400 dark:text-tower-500">Data</span>
                                                    <span className="font-medium text-tower-700 dark:text-tower-300">
                                                        {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-row md:flex-col justify-end gap-2 shrink-0">
                                            {item.type === 'OPPORTUNITY' && item.needsCollection && item.status !== 'COLLECTION_REQUESTED' && (
                                                <RouterLink
                                                    to={`/form/coleta/${item.id}`}
                                                    className="px-4 py-2 bg-brand-600 text-white font-bold rounded-xl text-sm hover:bg-brand-700 transition-all shadow-sm text-center"
                                                >
                                                    🚛 Solicitar Coleta
                                                </RouterLink>
                                            )}
                                            {item.type === 'DEMAND' && (
                                                <RouterLink
                                                    to={`/tracking/${item.id}`}
                                                    className="px-4 py-2 bg-brand-600 text-white font-bold rounded-xl text-sm hover:bg-brand-700 transition-all shadow-sm text-center"
                                                >
                                                    Ver Tracking
                                                </RouterLink>
                                            )}
                                            {item.type === 'ORDER' && (
                                                <RouterLink
                                                    to={`/orders/${item.id}`}
                                                    className="px-4 py-2 bg-brand-600 text-white font-bold rounded-xl text-sm hover:bg-brand-700 transition-all shadow-sm text-center"
                                                >
                                                    Ver Pedido
                                                </RouterLink>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'companies' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Gestão de CNPJs</h2>
                        <button
                            onClick={() => setShowAddCNPJ(true)}
                            className="px-4 py-2 bg-brand-600 text-white font-bold rounded-xl text-sm hover:bg-brand-700 transition-all"
                        >
                            + Adicionar CNPJ
                        </button>
                    </div>

                    {account.companies.length === 0 ? (
                        <div className="bg-white dark:bg-tower-800 border-2 border-dashed border-tower-200 dark:border-tower-700 rounded-2xl p-12 text-center text-tower-400 dark:text-tower-500">
                            Nenhum CNPJ cadastrado.
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {account.companies.map(company => (
                                <div key={company.id} className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-6">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="text-lg font-bold text-tower-900 dark:text-tower-100">{company.cnpj}</span>
                                                {company.isPrimary && (
                                                    <span className="px-2 py-1 bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 text-xs font-bold rounded">
                                                        PRIMÁRIO
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-sm text-tower-600 dark:text-tower-400">
                                                <div className="font-medium">{company.legalName}</div>
                                                {company.tradeName && (
                                                    <div className="text-tower-500 dark:text-tower-400">Nome Fantasia: {company.tradeName}</div>
                                                )}
                                                {company.city && company.state && (
                                                    <div className="text-tower-500 dark:text-tower-400">{company.city}, {company.state}</div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button className="px-3 py-1 text-sm text-tower-600 dark:text-tower-400 hover:text-brand-600 dark:hover:text-brand-400 font-medium">
                                                Editar
                                            </button>
                                            {!company.isPrimary && (
                                                <button className="px-3 py-1 text-sm text-red-600 hover:text-red-700 font-medium">
                                                    Remover
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'users' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Gestão de Usuários</h2>
                        <button
                            onClick={() => setShowAddUser(true)}
                            className="px-4 py-2 bg-brand-600 text-white font-bold rounded-xl text-sm hover:bg-brand-700 transition-all"
                        >
                            + Adicionar Usuário
                        </button>
                    </div>

                    {account.users.length === 0 ? (
                        <div className="bg-white dark:bg-tower-800 border-2 border-dashed border-tower-200 dark:border-tower-700 rounded-2xl p-12 text-center text-tower-400 dark:text-tower-500">
                            Nenhum usuário cadastrado.
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {account.users.map((user: AccountUser) => (
                                <div key={user.id} className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-6">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="font-bold text-tower-900 dark:text-tower-100">{user.email}</span>
                                                {!user.active && (
                                                    <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded">
                                                        INATIVO
                                                    </span>
                                                )}
                                            </div>
                                            {user.client && (
                                                <div className="text-sm text-tower-600 dark:text-tower-400">
                                                    <div>CNPJ: {user.client.document}</div>
                                                    <div>{user.client.companyName}</div>
                                                </div>
                                            )}
                                            <div className="text-xs text-tower-400 dark:text-tower-500 mt-2">
                                                Criado em {new Date(user.createdAt).toLocaleDateString('pt-BR')}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button className="px-3 py-1 text-sm text-tower-600 dark:text-tower-400 hover:text-brand-600 dark:hover:text-brand-400 font-medium">
                                                Editar
                                            </button>
                                            {user.active && (
                                                <button className="px-3 py-1 text-sm text-red-600 hover:text-red-700 font-medium">
                                                    Desativar
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'contacts' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Contatos</h2>
                        <button
                            onClick={() => setShowAddContact(true)}
                            className="px-4 py-2 bg-brand-600 text-white font-bold rounded-xl text-sm hover:bg-brand-700 transition-all"
                        >
                            + Adicionar Contato
                        </button>
                    </div>

                    {account.contacts.length === 0 ? (
                        <div className="bg-white dark:bg-tower-800 border-2 border-dashed border-tower-200 dark:border-tower-700 rounded-2xl p-12 text-center text-tower-400 dark:text-tower-500">
                            Nenhum contato cadastrado.
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {account.contacts.map(contact => (
                                <div key={contact.id} className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-6">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="font-bold text-tower-900 dark:text-tower-100">{contact.name}</span>
                                                {contact.isPrimary && (
                                                    <span className="px-2 py-1 bg-brand-100 text-brand-700 text-xs font-bold rounded">
                                                        TOMADOR DE DECISÃO
                                                    </span>
                                                )}
                                            </div>
                                            {contact.role && (
                                                <div className="text-sm text-tower-600 mb-2">{contact.role}</div>
                                            )}
                                            <div className="text-sm text-tower-500 dark:text-tower-400 space-y-1">
                                                {contact.email && <div>📧 {contact.email}</div>}
                                                {contact.phone && <div>📞 {contact.phone}</div>}
                                                {contact.whatsapp && <div>💬 {contact.whatsapp}</div>}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button className="px-3 py-1 text-sm text-tower-600 dark:text-tower-400 hover:text-brand-600 dark:hover:text-brand-400 font-medium">
                                                Editar
                                            </button>
                                            <button className="px-3 py-1 text-sm text-red-600 hover:text-red-700 font-medium">
                                                Remover
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'pricing' && (
                <div className="space-y-4">
                    <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Tabelas de Preço Especiais</h2>
                    <div className="bg-white dark:bg-tower-800 border dark:border-tower-700 rounded-2xl p-6">
                        <p className="text-tower-500 dark:text-tower-400 text-sm">
                            As tabelas de preço especiais são compartilhadas entre todos os CNPJs da sua conta.
                            Entre em contato com o administrador para configurar tabelas personalizadas.
                        </p>
                    </div>
                </div>
            )}

            {/* Modals */}
            <AddCNPJModal
                isOpen={showAddCNPJ}
                onClose={() => setShowAddCNPJ(false)}
                onSubmit={handleAddCNPJ}
                hasPrimary={account.companies.some(c => c.isPrimary)}
            />
            
            <AddUserModal
                isOpen={showAddUser}
                onClose={() => setShowAddUser(false)}
                onSubmit={handleAddUser}
                companies={account.companies}
            />
            
            <AddContactModal
                isOpen={showAddContact}
                onClose={() => setShowAddContact(false)}
                onSubmit={handleAddContact}
                hasPrimary={account.contacts.some(c => c.isPrimary)}
            />
        </div>
    );
};

export default ClientDashboard;
