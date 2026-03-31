
export enum RiskClass {
  A = 'A',
  B = 'B',
  C = 'C'
}

export enum OpType {
  PONTO_PONTO = 'Ponto -> Ponto',
  COLETA_HUB = 'Coleta -> HUB',
  HUB_HUB = 'HUB -> HUB',
  HUB_DESTINO = 'HUB -> Destino'
}

export enum CargoStatus {
  PENDENTE = 'Pendente',
  COTADO = 'Cotado',
  ORDEM_GERADA = 'Ordem Gerada',
  COLETADO = 'Coletado',
  EM_TRANSITO = 'Em Trânsito',
  NO_HUB = 'No HUB',
  ENTREGUE = 'Entregue',
  REJEITADO = 'Rejeitado'
}

export interface CargoEvent {
  id: string;
  status: CargoStatus;
  description: string;
  timestamp: string;
  location: string;
  photoUrl?: string;
}

export interface Cargo {
  id: string;
  origin: string;
  destination: string;
  commodity: string;
  value: number;
  weight: number;
  volumes: number;
  dimensions: string;
  needsCollection: boolean;
  riskClass?: RiskClass;
  opType?: OpType;
  status: CargoStatus;
  createdAt: string;
  price?: number;
  eta?: number; // em dias
  events: CargoEvent[];
  margin?: number; // % de margem
}

export interface Partner {
  id: string;
  name: string;
  type: 'HUB' | 'LINK';
  score: number;
  active: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
