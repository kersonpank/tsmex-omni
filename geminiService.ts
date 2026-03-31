
import { GoogleGenAI, Type, GenerateContentResponse, Modality } from "@google/genai";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const classifyCargo = async (details: string) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analise os seguintes detalhes de carga e classifique o risco (A, B ou C) e o tipo de operação logística sugerido. 
    Detalhes: ${details}
    
    Responda em formato JSON.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          riskClass: { type: Type.STRING, description: "A, B ou C" },
          opType: { type: Type.STRING, description: "Tipo de operação sugerido" },
          explanation: { type: Type.STRING, description: "Breve explicação da classificação" }
        },
        required: ["riskClass", "opType"]
      }
    }
  });
  
  try {
    return JSON.parse(response.text || '{}');
  } catch (e) {
    return { riskClass: 'B', opType: 'Ponto -> Ponto' };
  }
};

export const chatWithIA = async (history: { role: 'user' | 'assistant', content: string }[]) => {
  const ai = getAI();
  const chat = ai.chats.create({
    model: 'gemini-3-pro-preview',
    config: {
      systemInstruction: `Você é a TSM EX, uma IA assistente de logística. Seu objetivo é coletar dados para cotação de frete. 
      Siga exatamente esta ordem de perguntas se ainda não souber as respostas:
      1. Cidade e Estado de Origem
      2. Cidade e Estado de Destino
      3. O que é a mercadoria?
      4. Valor da Nota Fiscal
      5. Peso total (kg)
      6. Quantidade de volumes
      7. Medidas aproximadas
      8. Precisa de coleta?
      
      Seja cordial, profissional e direta.`,
      thinkingConfig: { thinkingBudget: 32768 }
    }
  });

  const lastMsg = history[history.length - 1];
  const response = await chat.sendMessage({ message: lastMsg.content });
  return response.text;
};

export const transcribeAudio = async (base64Audio: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { data: base64Audio, mimeType: 'audio/pcm;rate=16000' } },
        { text: "Transcreva este áudio para texto em português." }
      ]
    },
    config: {
      responseModalities: [Modality.AUDIO]
    }
  });
  return response.text || '';
};

export const generateCargoImage = async (prompt: string, aspectRatio: string = "1:1") => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: {
      parts: [{ text: `A professional logistics photo of: ${prompt}` }]
    },
    config: {
      imageConfig: {
        aspectRatio: aspectRatio as any,
        imageSize: "1K"
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
};
