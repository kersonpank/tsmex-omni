import React, { useState, useEffect } from 'react';
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
        CONVERTED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
        LOST: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:shadow-md dark:hover:shadow-slate-900/20 transition-shadow flex gap-2"
        >
            <button
                {...listeners}
                {...attributes}
                type="button"
                className="shrink-0 p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-grab active:cursor-grabbing touch-none"
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
                        <span className={`px-2 py-1 rounded text-xs font-bold ${statusColors[opportunity.stage] || 'bg-slate-100'}`}>
                            {opportunity.stage}
                        </span>
                        <span className="text-xs text-slate-400">
                            {new Date(opportunity.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                    </div>
                    {opportunity.quotedPrice && (
                        <div className="text-right">
                            <div className="text-sm font-bold text-emerald-600">
                                R$ {opportunity.quotedPrice.toLocaleString()}
                            </div>
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <div className="text-xs text-slate-400 uppercase font-bold mb-1">Rota</div>
                    <div className="text-slate-800 dark:text-slate-200 font-medium text-sm">
                        {opportunity.origin || 'Não informado'} → {opportunity.destination || 'Não informado'}
                    </div>
                </div>

                <div className="mb-3">
                    <div className="text-xs text-slate-400 uppercase font-bold mb-1">Carga</div>
                    <div className="text-slate-600 dark:text-slate-400 text-xs">
                        {opportunity.commodity && <span className="font-medium text-slate-700 dark:text-slate-300">{opportunity.commodity}</span>}
                        {opportunity.commodity && (opportunity.weight || opportunity.volumes || opportunity.nfValue) && ' • '}
                        {opportunity.weight ? `${opportunity.weight}kg` : '-'} •
                        {opportunity.volumes ? ` ${opportunity.volumes} vol` : ' -'} •
                        {opportunity.nfValue ? ` R$ ${opportunity.nfValue.toLocaleString()}` : ' -'}
                    </div>
                </div>

                <div className="flex justify-end gap-2 border-t pt-3 mt-3">
                    <span className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 font-medium rounded-lg">
                        Ver Detalhes
                    </span>
                    {opportunity.stage === 'QUOTE' && opportunity.completeness === 'COMPLETE' && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onConvert();
                            }}
                            disabled={converting}
                            className="px-3 py-1.5 text-xs bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
            className={`flex-shrink-0 w-80 bg-slate-50 dark:bg-slate-800 rounded-xl p-4 transition-colors ${
                isOver ? 'bg-indigo-50 dark:bg-indigo-900/30 border-2 border-indigo-300 dark:border-indigo-600' : ''
            }`}
        >
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <button
                        {...dragHandleProps}
                        type="button"
                        className="shrink-0 p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded cursor-grab active:cursor-grabbing touch-none"
                        aria-label="Arrastar coluna"
                    >
                        <span className="text-sm leading-none select-none">⋮⋮</span>
                    </button>
                    <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: column.color }}
                    />
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">{column.name}</h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-700 px-2 py-0.5 rounded-full">
                        {columnOpportunities.length}
                    </span>
                </div>
                <button className="text-slate-400 hover:text-slate-600 text-xs">⚙️</button>
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
                        <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-lg">
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
            const newOrder = arrayMove(columns, oldIndex, newIndex);
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

    return (
        <div>
            {!forceSubTab && (
            <div className="flex border-b border-slate-200 mb-6">
                <button
                    type="button"
                    onClick={() => setCommercialSubTab('pipeline')}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                        commercialSubTab === 'pipeline'
                            ? 'border-indigo-600 text-indigo-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                    Pipeline
                </button>
                <button
                    type="button"
                    onClick={() => setCommercialSubTab('tarifas')}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                        commercialSubTab === 'tarifas'
                            ? 'border-indigo-600 text-indigo-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
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
                    <div className="text-center text-slate-500">Carregando pipeline...</div>
                </div>
            ) : (
        <>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-bold text-slate-700">Pipeline de Oportunidades</h2>
                <div className="flex gap-2">
                    <button
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
                        className="px-4 py-2 text-sm bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700"
                    >
                        + Nova Coluna
                    </button>
                    <button onClick={loadData} className="px-4 py-2 text-sm text-slate-600 font-medium hover:bg-slate-100 rounded-lg">
                        ↻ Atualizar
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
                    {error}
                </div>
            )}

            {success && (
                <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl">
                    {success}
                </div>
            )}

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
                                opportunities={opportunities}
                                onCardClick={setSelectedOpportunity}
                                onConvert={handleConvertToDemand}
                                converting={converting}
                            />
                        ))}
                    </div>
                </SortableContext>

                <DragOverlay>
                    {activeId ? (
                        <div className="bg-white border border-slate-200 rounded-xl p-4 opacity-90 shadow-lg">
                            Arrastando...
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

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
