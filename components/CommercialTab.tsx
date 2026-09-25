import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragEndEvent,
    useDroppable,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    horizontalListSortingStrategy,
    useSortable,
    arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { opportunitiesApi, pipelineApi } from '../lib/api';
import type { Opportunity } from '../types/index';
import OpportunityDetailsModal from './admin/OpportunityDetailsModal';
import TarifasTab from './commercial/TarifasTab';
import { useRegisterGestaoModuleActions } from './admin/layout/GestaoModuleActionsContext';

interface PipelineColumn {
    id: string;
    name: string;
    color: string;
    stage: string | null;
    order: number;
    active: boolean;
    _count?: { opportunities: number };
}

interface OpportunityWithColumn extends Opportunity {
    pipelineColumnId?: string | null;
}

// Sortable Card Component
const SortableOpportunityCard: React.FC<{
    opportunity: OpportunityWithColumn;
    onClick: () => void;
    onConvert: () => void;
    converting: boolean;
}> = ({ opportunity, onClick, onConvert, converting }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: opportunity.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const statusColors: Record<string, string> = {
        QUOTE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200',
        FOLLOW_UP: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
        COLLECTION_REQUESTED: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200',
        CONVERTED: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200',
        LOST: 'bg-tower-100 text-tower-500 dark:bg-tower-700 dark:text-tower-400',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="bg-white dark:bg-tower-800 border border-tower-200 dark:border-tower-700 rounded-xl p-4 hover:shadow-md dark:hover:shadow-tower-900/20 transition-shadow flex gap-2"
        >
            <button
                {...listeners}
                {...attributes}
                type="button"
                className="shrink-0 p-1 text-tower-400 dark:text-tower-500 hover:text-tower-600 dark:hover:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-700 rounded cursor-grab active:cursor-grabbing touch-none"
                aria-label="Arrastar"
            >
                <span className="text-base leading-none select-none">⋮⋮</span>
            </button>
            <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onClick()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
            >
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${statusColors[opportunity.stage] || 'bg-tower-100'}`}>
                            {opportunity.stage}
                        </span>
                        <span className="text-xs text-tower-400">
                            {new Date(opportunity.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                    </div>
                    {opportunity.quotedPrice && (
                        <div className="text-right">
                            <div className="text-sm font-bold text-brand-600">
                                R$ {opportunity.quotedPrice.toLocaleString()}
                            </div>
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <div className="text-xs text-tower-400 uppercase font-bold mb-1">Rota</div>
                    <div className="text-tower-800 dark:text-tower-200 font-medium text-sm">
                        {opportunity.origin || 'Não informado'} → {opportunity.destination || 'Não informado'}
                    </div>
                </div>

                <div className="mb-3">
                    <div className="text-xs text-tower-400 uppercase font-bold mb-1">Carga</div>
                    <div className="text-tower-600 dark:text-tower-400 text-xs">
                        {opportunity.commodity && <span className="font-medium text-tower-700 dark:text-tower-300">{opportunity.commodity}</span>}
                        {opportunity.commodity && (opportunity.weight || opportunity.volumes || opportunity.nfValue) && ' • '}
                        {opportunity.weight ? `${opportunity.weight}kg` : '-'} •
                        {opportunity.volumes ? ` ${opportunity.volumes} vol` : ' -'} •
                        {opportunity.nfValue ? ` R$ ${opportunity.nfValue.toLocaleString()}` : ' -'}
                    </div>
                </div>

                <div className="flex justify-end gap-2 border-t pt-3 mt-3">
                    <span className="px-3 py-1.5 text-xs text-tower-600 dark:text-tower-400 font-medium rounded-lg">
                        Ver Detalhes
                    </span>
                    {opportunity.stage === 'QUOTE' && opportunity.completeness === 'COMPLETE' && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onConvert();
                            }}
                            disabled={converting}
                            className="px-3 py-1.5 text-xs bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {converting ? '...' : 'Gerar'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// Droppable Column (inner) - receives ref from parent
const DroppableColumnInner: React.FC<{
    column: PipelineColumn;
    opportunities: OpportunityWithColumn[];
    onCardClick: (opp: OpportunityWithColumn) => void;
    onConvert: (id: string) => void;
    converting: string | null;
    dragHandleProps: React.HTMLAttributes<HTMLButtonElement>;
}> = ({ column, opportunities, onCardClick, onConvert, converting, dragHandleProps }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: column.id,
    });

    const columnOpportunities = opportunities.filter(
        opp => opp.pipelineColumnId === column.id || (!opp.pipelineColumnId && column.stage === opp.stage)
    );

    return (
        <div
            ref={setNodeRef}
            className={`flex-shrink-0 w-80 bg-tower-50 dark:bg-tower-800 rounded-xl p-4 transition-colors ${
                isOver ? 'bg-brand-50 dark:bg-brand-900/30 border-2 border-brand-300 dark:border-brand-600' : ''
            }`}
        >
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <button
                        {...dragHandleProps}
                        type="button"
                        className="shrink-0 p-1 text-tower-400 dark:text-tower-500 hover:text-tower-600 dark:hover:text-tower-300 hover:bg-tower-200 dark:hover:bg-tower-700 rounded cursor-grab active:cursor-grabbing touch-none"
                        aria-label="Arrastar coluna"
                    >
                        <span className="text-sm leading-none select-none">⋮⋮</span>
                    </button>
                    <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: column.color }}
                    />
                    <h3 className="font-bold text-tower-800 dark:text-tower-200">{column.name}</h3>
                    <span className="text-xs text-tower-500 dark:text-tower-400 bg-white dark:bg-tower-700 px-2 py-0.5 rounded-full">
                        {columnOpportunities.length}
                    </span>
                </div>
                <button className="text-tower-400 hover:text-tower-600 text-xs">⚙️</button>
            </div>

            <SortableContext
                items={columnOpportunities.map(opp => opp.id)}
                strategy={verticalListSortingStrategy}
            >
                <div className="space-y-3 min-h-[200px]">
                    {columnOpportunities.map((opp) => (
                        <SortableOpportunityCard
                            key={opp.id}
                            opportunity={opp}
                            onClick={() => onCardClick(opp)}
                            onConvert={() => onConvert(opp.id)}
                            converting={converting === opp.id}
                        />
                    ))}
                    {columnOpportunities.length === 0 && (
                        <div className="text-center py-8 text-tower-400 dark:text-tower-500 text-sm border-2 border-dashed border-tower-200 dark:border-tower-600 rounded-lg">
                            Arraste oportunidades aqui
                        </div>
                    )}
                </div>
            </SortableContext>
        </div>
    );
};

// Sortable + Droppable Column wrapper
const SortableDroppableColumn: React.FC<{
    column: PipelineColumn;
    opportunities: OpportunityWithColumn[];
    onCardClick: (opp: OpportunityWithColumn) => void;
    onConvert: (id: string) => void;
    converting: string | null;
}> = (props) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: props.column.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className="flex-shrink-0">
            <DroppableColumnInner
                {...props}
                dragHandleProps={{ ...attributes, ...listeners }}
            />
        </div>
    );
};

type CommercialSubTab = 'pipeline' | 'tarifas';

const CommercialTab: React.FC<{ forceSubTab?: CommercialSubTab }> = ({ forceSubTab }) => {
    const [commercialSubTab, setCommercialSubTab] = useState<CommercialSubTab>(forceSubTab ?? 'pipeline');
    const [opportunities, setOpportunities] = useState<OpportunityWithColumn[]>([]);
    const [columns, setColumns] = useState<PipelineColumn[]>([]);
    const [loading, setLoading] = useState(true);
    const [converting, setConverting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityWithColumn | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
    const [filterPanelOpen, setFilterPanelOpen] = useState(false);
    const [filterStage, setFilterStage] = useState<string>('');
    const [filterSearch, setFilterSearch] = useState('');
    const [pipelineSelectedId, setPipelineSelectedId] = useState<string | null>(null);
    const [showCreateOpp, setShowCreateOpp] = useState(false);
    const [createAccountId, setCreateAccountId] = useState('');
    const [createOrigin, setCreateOrigin] = useState('');
    const [createDestination, setCreateDestination] = useState('');
    const [createSaving, setCreateSaving] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            setError(null);
            const [oppsRes, colsRes] = await Promise.all([
                opportunitiesApi.list({ limit: 100 }),
                pipelineApi.getColumns(),
            ]);
            setOpportunities(oppsRes.data || []);
            setColumns(colsRes.data || []);
        } catch (error) {
            console.error(error);
            setError('Erro ao carregar dados');
        } finally {
            setLoading(false);
        }
    };

    const handleConvertToDemand = async (opportunityId: string) => {
        try {
            setConverting(opportunityId);
            setError(null);
            setSuccess(null);
            
            await opportunitiesApi.convertToDemand(opportunityId);
            
            setSuccess('Oportunidade convertida para demanda com sucesso!');
            await loadData();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err: any) {
            console.error('Erro ao converter oportunidade:', err);
            setError(err?.response?.data?.error || 'Erro ao converter oportunidade para demanda');
        } finally {
            setConverting(null);
        }
    };

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const filteredOpportunities = useMemo(() => {
        let list = opportunities;
        if (filterStage) {
            list = list.filter((o) => o.stage === filterStage);
        }
        const q = filterSearch.trim().toLowerCase();
        if (q) {
            list = list.filter((o) => {
                const acc = (o as any).account?.name?.toLowerCase?.() ?? '';
                const origin = (o.origin ?? '').toLowerCase();
                const dest = (o.destination ?? '').toLowerCase();
                const comm = (o.commodity ?? '').toLowerCase();
                return acc.includes(q) || origin.includes(q) || dest.includes(q) || comm.includes(q);
            });
        }
        return list;
    }, [opportunities, filterStage, filterSearch]);

    const handleCreateOpportunity = async () => {
        const aid = createAccountId.trim();
        if (!aid) {
            setError('Informe o UUID da conta (accountId).');
            return;
        }
        setCreateSaving(true);
        setError(null);
        try {
            await opportunitiesApi.create({
                accountId: aid,
                sessionId: crypto.randomUUID(),
                type: 'QUOTE_ONLY',
                source: 'MANUAL',
                origin: createOrigin.trim() || undefined,
                destination: createDestination.trim() || undefined,
                conversationSnapshot: [],
            });
            setShowCreateOpp(false);
            setCreateAccountId('');
            setCreateOrigin('');
            setCreateDestination('');
            setSuccess('Oportunidade criada.');
            await loadData();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err: any) {
            setError(err?.response?.data?.error || 'Erro ao criar oportunidade');
        } finally {
            setCreateSaving(false);
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const isColumnDrag = columns.some(c => c.id === active.id);

        if (isColumnDrag) {
            const oldIndex = columns.findIndex(c => c.id === active.id);
            let overColumnId = columns.some(c => c.id === over.id) ? over.id as string : undefined;
            if (!overColumnId) {
                const overOpp = opportunities.find(o => o.id === over.id);
                if (overOpp) {
                    const col = columns.find(c => c.id === overOpp.pipelineColumnId || (!overOpp.pipelineColumnId && c.stage === overOpp.stage));
                    overColumnId = col?.id;
                }
            }
            const newIndex = overColumnId ? columns.findIndex(c => c.id === overColumnId) : -1;
            if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
            const newOrder = arrayMove<PipelineColumn>(columns, oldIndex, newIndex);
            try {
                await pipelineApi.reorderColumns(newOrder.map(c => c.id));
                setColumns(newOrder);
            } catch (err: any) {
                setError(err?.response?.data?.error || 'Erro ao reordenar colunas');
            }
            return;
        }

        const activeOpportunity = opportunities.find(opp => opp.id === active.id);
        if (!activeOpportunity) return;

        // Find target column - pode ser o ID da coluna ou um card dentro da coluna
        let targetColumn: PipelineColumn | undefined;
        
        // Primeiro tenta encontrar coluna diretamente
        targetColumn = columns.find(col => col.id === over.id);
        
        // Se não encontrou, pode ser que over.id seja um card dentro da coluna
        // Nesse caso, precisamos encontrar a coluna que contém esse card
        if (!targetColumn) {
            const targetOpportunity = opportunities.find(opp => opp.id === over.id);
            if (targetOpportunity) {
                // Encontrar a coluna que contém essa opportunity
                targetColumn = columns.find(
                    col => col.id === targetOpportunity.pipelineColumnId || 
                    (!targetOpportunity.pipelineColumnId && col.stage === targetOpportunity.stage)
                );
            }
        }

        if (!targetColumn) return;

        // Não fazer nada se já está na mesma coluna
        const currentColumn = columns.find(
            col => col.id === activeOpportunity.pipelineColumnId || 
            (!activeOpportunity.pipelineColumnId && col.stage === activeOpportunity.stage)
        );
        
        if (currentColumn?.id === targetColumn.id) return;

        try {
            await pipelineApi.moveOpportunity(activeOpportunity.id, targetColumn.id);
            await loadData();
        } catch (err: any) {
            console.error('Erro ao mover oportunidade:', err);
            setError('Erro ao mover oportunidade. Tente novamente.');
        }
    };

    const effectiveSubTab = forceSubTab ?? commercialSubTab;

    const gestaoPipeline = useMemo(
        () =>
            effectiveSubTab !== 'pipeline'
                ? null
                : {
                      listActive: viewMode === 'table',
                      filterOpen: filterPanelOpen,
                      filterCount: (filterStage ? 1 : 0) + (filterSearch.trim() ? 1 : 0),
                      pills: [
                          ...(filterStage
                              ? [{ id: 'st', label: `Estágio: ${filterStage}`, onRemove: () => setFilterStage('') }]
                              : []),
                          ...(filterSearch.trim()
                              ? [
                                    {
                                        id: 'q',
                                        label: `Busca: ${filterSearch.trim()}`,
                                        onRemove: () => setFilterSearch(''),
                                    },
                                ]
                              : []),
                      ],
                      onList: () => {
                          setFilterPanelOpen(false);
                          setViewMode((m) => (m === 'kanban' ? 'table' : 'kanban'));
                      },
                      onFilterToggle: () => setFilterPanelOpen((v) => !v),
                      onEdit: pipelineSelectedId
                          ? () => {
                                const o = opportunities.find((x) => x.id === pipelineSelectedId);
                                if (o) setSelectedOpportunity(o);
                            }
                          : undefined,
                      onNew: () => setShowCreateOpp(true),
                      disabled: {
                          edit: !pipelineSelectedId,
                      } as const,
                      labels: {
                          list:
                              viewMode === 'kanban'
                                  ? 'Alternar para visão em tabela'
                                  : 'Alternar para visão em pipeline (Kanban)',
                          edit: pipelineSelectedId
                              ? 'Abrir detalhes da oportunidade selecionada'
                              : 'Selecione uma oportunidade na tabela ou um card no Kanban',
                      },
                  },
        [
            effectiveSubTab,
            viewMode,
            filterPanelOpen,
            filterStage,
            filterSearch,
            pipelineSelectedId,
            opportunities,
        ]
    );

    useRegisterGestaoModuleActions(() => gestaoPipeline, [gestaoPipeline]);

    return (
        <div>
            {!forceSubTab && (
            <div className="flex border-b border-tower-200 dark:border-tower-800 mb-6">
                <button
                    type="button"
                    onClick={() => setCommercialSubTab('pipeline')}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                        commercialSubTab === 'pipeline'
                            ? 'border-brand-600 text-brand-600'
                            : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-200'
                    }`}
                >
                    Pipeline
                </button>
                <button
                    type="button"
                    onClick={() => setCommercialSubTab('tarifas')}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                        commercialSubTab === 'tarifas'
                            ? 'border-brand-600 text-brand-600'
                            : 'border-transparent text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-200'
                    }`}
                >
                    Tarifas
                </button>
            </div>
            )}

            {effectiveSubTab === 'tarifas' && <TarifasTab />}

            {effectiveSubTab === 'pipeline' && (
        <>
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="text-center text-tower-500">Carregando pipeline...</div>
                </div>
            ) : (
        <>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Pipeline de Oportunidades</h2>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={async () => {
                            try {
                                const name = prompt('Nome da nova coluna:');
                                if (!name) return;
                                const color = prompt('Cor (hex, ex: #3B82F6):', '#3B82F6') || '#3B82F6';
                                await pipelineApi.createColumn({ name, color });
                                await loadData();
                            } catch (err: any) {
                                setError('Erro ao criar coluna');
                            }
                        }}
                        className="px-4 py-2 text-sm bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700"
                    >
                        + Nova Coluna
                    </button>
                    <button type="button" onClick={loadData} className="px-4 py-2 text-sm text-tower-600 font-medium hover:bg-tower-100 rounded-lg dark:text-tower-300 dark:hover:bg-tower-800">
                        ↻ Atualizar
                    </button>
                </div>
            </div>

            {filterPanelOpen && (
                <div className="mb-4 rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
                    <div className="flex flex-wrap gap-4">
                        <div>
                            <label className="mb-1 block text-xs font-bold text-tower-600 dark:text-tower-400" htmlFor="opp-stage">
                                Estágio
                            </label>
                            <select
                                id="opp-stage"
                                value={filterStage}
                                onChange={(e) => setFilterStage(e.target.value)}
                                className="rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                            >
                                <option value="">Todos</option>
                                {Array.from(new Set(opportunities.map((o) => o.stage))).map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="min-w-[200px] flex-1">
                            <label className="mb-1 block text-xs font-bold text-tower-600 dark:text-tower-400" htmlFor="opp-q">
                                Busca (conta, rota, mercadoria)
                            </label>
                            <input
                                id="opp-q"
                                type="search"
                                value={filterSearch}
                                onChange={(e) => setFilterSearch(e.target.value)}
                                className="w-full rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                            />
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="mb-4 bg-red-50 dark:bg-brand-red-500/15 border border-red-200 dark:border-brand-red-500/25 text-red-700 dark:text-brand-red-400 px-4 py-3 rounded-xl">
                    {error}
                </div>
            )}

            {success && (
                <div className="mb-4 bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-900/40 text-brand-800 dark:text-brand-400 px-4 py-3 rounded-xl">
                    {success}
                </div>
            )}

            {viewMode === 'kanban' ? (
            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={columns.map(c => c.id)}
                    strategy={horizontalListSortingStrategy}
                >
                    <div className="flex gap-4 overflow-x-auto pb-4">
                        {columns.map((column) => (
                            <SortableDroppableColumn
                                key={column.id}
                                column={column}
                                opportunities={filteredOpportunities}
                                onCardClick={(opp) => {
                                    setPipelineSelectedId(opp.id);
                                    setSelectedOpportunity(opp);
                                }}
                                onConvert={handleConvertToDemand}
                                converting={converting}
                            />
                        ))}
                    </div>
                </SortableContext>

                <DragOverlay>
                    {activeId ? (
                        <div className="bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-4 opacity-90 shadow-lg">
                            Arrastando...
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-tower-200 bg-white dark:border-tower-600 dark:bg-tower-800">
                    <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="border-b border-tower-200 bg-tower-50 dark:border-tower-600 dark:bg-tower-900">
                            <tr>
                                <th className="px-3 py-2 font-semibold text-tower-800 dark:text-tower-200">Estágio</th>
                                <th className="px-3 py-2 font-semibold text-tower-800 dark:text-tower-200">Data</th>
                                <th className="px-3 py-2 font-semibold text-tower-800 dark:text-tower-200">Conta</th>
                                <th className="px-3 py-2 font-semibold text-tower-800 dark:text-tower-200">Rota</th>
                                <th className="px-3 py-2 font-semibold text-tower-800 dark:text-tower-200">Mercadoria</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOpportunities.map((o) => (
                                <tr
                                    key={o.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setPipelineSelectedId(o.id)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setPipelineSelectedId(o.id);
                                        }
                                    }}
                                    className={`cursor-pointer border-b border-tower-100 hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-700/50 ${
                                        pipelineSelectedId === o.id ? 'bg-brand-50 dark:bg-brand-950/40' : ''
                                    }`}
                                >
                                    <td className="px-3 py-2 text-tower-800 dark:text-tower-200">{o.stage}</td>
                                    <td className="px-3 py-2 text-tower-600 dark:text-tower-400">
                                        {new Date(o.createdAt).toLocaleDateString('pt-BR')}
                                    </td>
                                    <td className="px-3 py-2 text-tower-800 dark:text-tower-200">
                                        {(o as any).account?.name ?? (o as any).account?.companies?.[0]?.legalName ?? '—'}
                                    </td>
                                    <td className="px-3 py-2 text-tower-700 dark:text-tower-300">
                                        {(o.origin || '—') + ' → ' + (o.destination || '—')}
                                    </td>
                                    <td className="px-3 py-2 text-tower-600 dark:text-tower-400">{o.commodity ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showCreateOpp && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-tower-950/70 p-4 backdrop-blur-sm"
                    onClick={() => setShowCreateOpp(false)}
                    role="presentation"
                >
                    <div
                        className="w-full max-w-md rounded-2xl border border-tower-200 bg-white p-6 shadow-xl dark:border-tower-600 dark:bg-tower-900"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal
                    >
                        <h3 className="mb-3 text-lg font-bold text-tower-900 dark:text-tower-50">Nova oportunidade</h3>
                        <p className="mb-4 text-xs text-tower-600 dark:text-tower-400">
                            Informe o UUID da conta (account). Origem e destino são opcionais.
                        </p>
                        <div className="space-y-3">
                            <div>
                                <label className="mb-1 block text-xs font-semibold" htmlFor="opp-acc">
                                    accountId (UUID)
                                </label>
                                <input
                                    id="opp-acc"
                                    className="w-full rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                                    value={createAccountId}
                                    onChange={(e) => setCreateAccountId(e.target.value)}
                                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold" htmlFor="opp-orig">
                                    Origem
                                </label>
                                <input
                                    id="opp-orig"
                                    className="w-full rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                                    value={createOrigin}
                                    onChange={(e) => setCreateOrigin(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold" htmlFor="opp-dest">
                                    Destino
                                </label>
                                <input
                                    id="opp-dest"
                                    className="w-full rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
                                    value={createDestination}
                                    onChange={(e) => setCreateDestination(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="mt-4 flex gap-2">
                            <button
                                type="button"
                                className="flex-1 rounded-xl border border-tower-200 py-2 text-sm dark:border-tower-600"
                                onClick={() => setShowCreateOpp(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={createSaving}
                                className="flex-1 rounded-xl bg-brand-600 py-2 text-sm font-bold text-white disabled:opacity-50"
                                onClick={() => void handleCreateOpportunity()}
                            >
                                {createSaving ? 'Salvando…' : 'Criar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedOpportunity && (
                <OpportunityDetailsModal
                    opportunity={selectedOpportunity}
                    onClose={() => setSelectedOpportunity(null)}
                    onConvert={handleConvertToDemand}
                />
            )}
        </>
            )}
        </>
            )}
        </div>
    );
};

export default CommercialTab;
