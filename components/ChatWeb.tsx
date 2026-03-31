import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import AddCNPJModal from './client/AddCNPJModal';
import ThemeToggle from './ui/ThemeToggle';
import { accountsApi } from '../lib/api';

// ==================== TYPES ====================

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  opportunities?: Opportunity[];
  needsAccount?: boolean;
  needsAddCnpj?: boolean;
  cnpjSuggest?: string | null;
  attachments?: Array<{
    url: string;
    fileName: string;
    type: 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'NF';
  }>;
}

interface Opportunity {
  id: string;
  origin: string;
  destination: string;
  weight?: number;
  nfValue?: number;
  volumes?: number;
  commodity?: string;
  quotedPrice?: number;
  quoteBreakdown?: {
    freight: number;
    gris: number;
    advalorem: number;
    icms?: number;
    total: number;
  };
  needsCollection?: boolean;
  completeness?: 'MINIMAL' | 'INCOMPLETE' | 'COMPLETE';
}

// ==================== CONFIG ====================

const API_URL = (window.location.hostname === 'localhost' && window.location.port === '3000')
  ? '/api'
  : 'http://localhost:3002/api';

function formatCnpjDisplay(v: string): string {
  const d = v.replace(/\D/g, '');
  if (d.length !== 14) return v;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// ==================== COMPONENT ====================

const ChatWeb: React.FC = () => {
  const { slug } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Olá! 👋 Sou a TSM EX.\n\nVou te ajudar com cotações, ordens de coleta e envios. De onde sai sua carga e para onde vai?',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId] = useState(() => slug || `session-${Date.now()}`);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [attachments, setAttachments] = useState<Array<{ file: File; preview: string }>>([]);
  const [addCnpjOpen, setAddCnpjOpen] = useState(false);
  const [addCnpjSuggest, setAddCnpjSuggest] = useState<string | null>(null);
  const [hasPrimaryCompany, setHasPrimaryCompany] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const callBackendChat = async (
    message: string,
    chatHistory: Array<{ role: string; content: string }>,
    attachmentsPayload?: Array<{ url: string; fileName: string; type: string }>
  ) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message,
        history: chatHistory,
        sessionId,
        attachments: attachmentsPayload || [],
      }),
    });
    if (!res.ok) throw new Error('Erro na API de Chat');
    return res.json();
  };

  const uploadFile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const token = localStorage.getItem('token');
          const response = await fetch(`${API_URL}/chat/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              file: base64,
              fileName: file.name,
              mimeType: file.type,
              type: file.type.startsWith('image/')
                ? 'IMAGE'
                : file.type.startsWith('audio/')
                  ? 'AUDIO'
                  : file.type === 'application/pdf'
                    ? 'NF'
                    : 'DOCUMENT',
            }),
          });
          if (!response.ok) throw new Error('Upload failed');
          const data = await response.json();
          resolve(data.data.fileUrl);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const fileType = (f: File) =>
    f.type.startsWith('image/') ? 'IMAGE' : f.type.startsWith('audio/') ? 'AUDIO' : f.type === 'application/pdf' ? 'NF' : 'DOCUMENT';

  const sendMessage = useCallback(
    async (text: string, attachmentsList?: Array<{ file: File; preview: string }>) => {
      let uploaded: Array<{ url: string; fileName: string; type: string }> = [];
      let messageContent = text;

      if (attachmentsList?.length) {
        try {
          const urls = await Promise.all(attachmentsList.map((a) => uploadFile(a.file)));
          uploaded = urls.map((url, i) => ({
            url,
            fileName: attachmentsList[i].file.name,
            type: fileType(attachmentsList[i].file),
          }));
          const refs = uploaded.map((u, i) => `[Arquivo ${i + 1}: ${u.fileName}]`).join(' ');
          messageContent = text ? `${text}\n\n${refs}` : refs;
        } catch (e) {
          console.error(e);
          alert('Erro ao fazer upload. Tente novamente.');
          return;
        }
      }

      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: messageContent,
        timestamp: new Date().toISOString(),
        attachments: uploaded.length ? uploaded : undefined,
      };

      const updated = [...messages, userMsg];
      setMessages(updated);
      setInput('');
      setAttachments([]);
      setIsTyping(true);

      try {
        const history = updated
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content }));

        const {
          response,
          opportunity,
          needsAccount,
          needsAddCnpj,
          cnpjSuggest,
        } = await callBackendChat(messageContent, history, uploaded.length ? uploaded : undefined);

        const opportunitiesList = opportunity ? [opportunity] : undefined;
        if (opportunity) {
          setOpportunities((prev) => {
            const ex = prev.find((o) => o.id === opportunity.id);
            if (ex) return prev.map((o) => (o.id === opportunity.id ? opportunity : o));
            return [...prev, opportunity];
          });
        }

        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: response,
          timestamp: new Date().toISOString(),
          opportunities: opportunitiesList,
          needsAccount: needsAccount ?? false,
          needsAddCnpj: needsAddCnpj ?? false,
          cnpjSuggest: cnpjSuggest ?? null,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        console.error(err);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Desculpe, tive um problema de conexão. Tente novamente.',
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setIsTyping(false);
      }
    },
    [messages, sessionId]
  );

  const handleSend = () => {
    if (!input.trim() && !attachments.length) return;
    sendMessage(input.trim() || ' ', attachments.length ? attachments : undefined);
  };

  const openAddCnpjModal = (cnpj: string) => {
    accountsApi.getCompanies().then((r) => {
      const list = r.data || [];
      setHasPrimaryCompany(list.length > 0);
      setAddCnpjSuggest(cnpj);
      setAddCnpjOpen(true);
    }).catch(() => {
      setHasPrimaryCompany(false);
      setAddCnpjSuggest(cnpj);
      setAddCnpjOpen(true);
    });
  };

  const handleAddCnpjSubmit = async (data: {
    cnpj: string;
    legalName: string;
    tradeName?: string;
    address?: string;
    city?: string;
    state?: string;
    isPrimary: boolean;
  }) => {
    await accountsApi.addCompany({
      cnpj: data.cnpj,
      legalName: data.legalName,
      tradeName: data.tradeName,
      address: data.address,
      city: data.city,
      state: data.state,
      isPrimary: data.isPrimary,
    });
    setAddCnpjOpen(false);
    setAddCnpjSuggest(null);
    await sendMessage('Adicionei o CNPJ à minha conta. Pode continuar com a cotação.');
  };

  const handleRequestCollection = (opp: Opportunity) => {
    setOpportunities((prev) =>
      prev.map((o) => (o.id === opp.id ? { ...o, needsCollection: true } : o))
    );
    sendMessage(
      `Quero solicitar coleta para essa cotação: ${opp.origin} → ${opp.destination}.`
    );
  };

  const handleEdit = (opp: Opportunity) => {
    setInput(`Quero ajustar a cotação de ${opp.origin} → ${opp.destination}: `);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const isImage = file.type.startsWith('image/');
      const isAudio = file.type.startsWith('audio/');
      const isDoc = file.type === 'application/pdf' || file.type.includes('document');
      if (!isImage && !isAudio && !isDoc) {
        alert(`Tipo não suportado: ${file.type}. Use imagens, áudio ou PDF.`);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert(`Arquivo muito grande: ${file.name}. Máximo 10MB.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments((prev) => [
          ...prev,
          { file, preview: (ev.target?.result as string) || file.name },
        ]);
      };
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // ==================== RENDER ====================

  return (
    <div className="h-screen bg-gradient-to-br from-slate-100 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 flex flex-col overflow-hidden">
      <header className="flex-shrink-0 bg-white/80 dark:bg-slate-800/50 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold">TSM</span>
            </div>
            <div>
              <h1 className="text-slate-900 dark:text-white font-semibold">TSM EX • Chat</h1>
              <p className="text-slate-500 dark:text-slate-400 text-xs">Cotação e coleta inteligente</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle className="!p-2" />
            <Link
              to="/form/cotacao"
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Cotação
            </Link>
            <Link
              to="/form/coleta"
              className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-sm font-medium rounded-xl transition-colors"
            >
              Coleta
            </Link>
            <Link
              to="/client"
              className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 min-h-0">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-700/80 text-slate-800 dark:text-slate-100'
                }`}
              >
                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>

                {msg.attachments?.length ? (
                  <div className="mt-3 space-y-2">
                    {msg.attachments.map((att, idx) => (
                      <div key={idx} className="bg-black/20 rounded-lg p-2">
                        {att.type === 'IMAGE' ? (
                          <img
                            src={att.url}
                            alt={att.fileName}
                            className="max-w-full max-h-64 rounded-lg"
                          />
                        ) : (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-lg">
                              {att.type === 'AUDIO' ? '🎵' : att.type === 'NF' ? '📄' : '📎'}
                            </span>
                            <span>{att.fileName}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {msg.needsAccount ? (
                  <div className="mt-4 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl p-6 border border-indigo-500">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                        <span className="text-2xl">📋</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-white font-bold text-lg mb-2">Crie sua conta para continuar</h3>
                        <p className="text-indigo-100 text-sm mb-4">
                          Para criar cotações e acompanhar envios, você precisa de uma conta. É rápido e gratuito!
                        </p>
                        <button
                          onClick={() => (window.location.href = '/onboarding')}
                          className="px-6 py-3 bg-white text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition-colors shadow-lg"
                        >
                          Criar Conta Agora
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {msg.needsAddCnpj && msg.cnpjSuggest ? (
                  <div className="mt-4 bg-gradient-to-br from-amber-600 to-orange-600 rounded-xl p-6 border border-amber-500">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                        <span className="text-2xl">🏢</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-white font-bold text-lg mb-2">Adicionar CNPJ à sua conta</h3>
                        <p className="text-amber-100 text-sm mb-4">
                          Para seguir com a cotação, adicione este CNPJ à sua conta e tenha acesso a todos os benefícios.
                        </p>
                        <p className="text-white/90 font-mono text-sm mb-4">{formatCnpjDisplay(msg.cnpjSuggest)}</p>
                        <button
                          onClick={() => openAddCnpjModal(msg.cnpjSuggest!)}
                          className="px-6 py-3 bg-white text-amber-600 font-bold rounded-xl hover:bg-amber-50 transition-colors shadow-lg"
                        >
                          Adicionar CNPJ
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {msg.opportunities?.length ? (
                  <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                    {msg.opportunities.map((opp) => (
                      <div
                        key={opp.id}
                        className="flex-shrink-0 w-72 bg-slate-100 dark:bg-slate-800/80 rounded-xl p-4 border border-slate-300 dark:border-slate-600"
                      >
                        <div className="text-sm font-medium text-slate-900 dark:text-white mb-2">
                          {opp.origin} → {opp.destination}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                          {opp.weight != null && <span>{opp.weight} kg</span>}
                          {opp.volumes != null && <span> • {opp.volumes} vol</span>}
                          {opp.nfValue != null && (
                            <span> • NF R$ {opp.nfValue.toLocaleString()}</span>
                          )}
                        </div>
                        {opp.quoteBreakdown ? (
                          <div className="space-y-1 text-xs border-t border-slate-300 dark:border-slate-600 pt-3 mb-3">
                            <div className="flex justify-between text-slate-500 dark:text-slate-400">
                              <span>Frete</span>
                              <span>R$ {opp.quoteBreakdown.freight.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-slate-500 dark:text-slate-400">
                              <span>GRIS</span>
                              <span>R$ {opp.quoteBreakdown.gris.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-slate-500 dark:text-slate-400">
                              <span>Ad Valorem</span>
                              <span>R$ {opp.quoteBreakdown.advalorem.toFixed(2)}</span>
                            </div>
                            {opp.quoteBreakdown.icms != null ? (
                              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                                <span>ICMS</span>
                                <span>R$ {opp.quoteBreakdown.icms.toFixed(2)}</span>
                              </div>
                            ) : null}
                            <div className="flex justify-between text-slate-900 dark:text-white font-semibold pt-2 border-t border-slate-300 dark:border-slate-600">
                              <span>TOTAL</span>
                              <span>R$ {opp.quoteBreakdown.total.toFixed(2)}</span>
                            </div>
                          </div>
                        ) : null}
                        {opp.completeness && opp.completeness !== 'COMPLETE' ? (
                          <div className="text-xs text-amber-400 mb-3">
                            ⚠️ Dados incompletos — informe peso e valor NF
                          </div>
                        ) : null}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRequestCollection(opp)}
                            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
                          >
                            🚛 Solicitar Coleta
                          </button>
                          <button
                            onClick={() => handleEdit(opp)}
                            className="px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white text-xs font-medium rounded-lg transition-colors"
                          >
                            📝 Editar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {isTyping ? (
              <div className="flex justify-start">
              <div className="bg-slate-200 dark:bg-slate-700/80 rounded-2xl px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-slate-500 dark:bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {attachments.length > 0 ? (
        <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 px-4 py-3">
          <div className="max-w-3xl mx-auto flex gap-2 overflow-x-auto">
            {attachments.map((att, idx) => (
              <div key={idx} className="flex-shrink-0 relative">
                {att.file.type.startsWith('image/') ? (
                  <div className="relative">
                    <img
                      src={att.preview}
                      alt={att.file.name}
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                    <button
                      onClick={() => removeAttachment(idx)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="relative bg-slate-200 dark:bg-slate-700 rounded-lg p-3 min-w-[120px]">
                    <div className="text-xs text-slate-700 dark:text-slate-300 truncate">{att.file.name}</div>
                    <button
                      onClick={() => removeAttachment(idx)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/50 backdrop-blur-sm px-4 py-4">
        <div className="max-w-3xl mx-auto flex gap-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,audio/*,.pdf,.doc,.docx"
            onChange={handleFileSelect}
            className="hidden"
            id="file-input"
          />
          <label
            htmlFor="file-input"
            className="px-4 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-xl cursor-pointer transition-colors flex items-center justify-center"
            title="Anexar (imagem, áudio, NF)"
          >
            📎
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Digite sua mensagem..."
            className="flex-1 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-transparent rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && !attachments.length) || isTyping}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
          >
            Enviar
          </button>
        </div>
      </div>

      <AddCNPJModal
        isOpen={addCnpjOpen}
        onClose={() => {
          setAddCnpjOpen(false);
          setAddCnpjSuggest(null);
        }}
        onSubmit={handleAddCnpjSubmit}
        hasPrimary={hasPrimaryCompany}
        initialCnpj={addCnpjSuggest ?? undefined}
      />
    </div>
  );
};

export default ChatWeb;
