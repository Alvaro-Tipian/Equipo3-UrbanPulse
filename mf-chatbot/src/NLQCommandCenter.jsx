import React, { useState, useRef, useEffect, Suspense } from 'react';
import { Send, Camera, Bot, User, MapPin, AlertTriangle, CheckCircle, LogOut } from 'lucide-react';
import './index.css';
import RespuestaRAG from './RespuestaRAG';
import ResumenReporte from './ResumenReporte';
import { esConsulta, parsearResumen } from './utilsChat';
import { respuestaMockConsulta } from './mock/consulta';

// HT-50 / T04: mientras el RAG no esté en staging, TE_RAG_MOCK=true responde consultas con el mock del contrato 4.8
const USAR_MOCK_RAG = import.meta.env.TE_RAG_MOCK === 'true';

// ✨ NUEVO 1: Importamos todo desde tu módulo compartido
import { getSession, saveSession, clearSession, subscribeSession, fetchN8n } from '@urbanpulse/shared';

// ✨ NUEVO 2: ¡Adiós a las URLs largas y estáticas! fetchN8n ya sabe la ruta base.

// Coordenadas de respaldo (Lima) si el navegador no da permiso de geolocalización o no la soporta
const FALLBACK_LAT = -12.0464;
const FALLBACK_LON = -77.0428;

// Componente federado importado perezosamente desde el microfrontend mf_auth
const ChatAuthGate = React.lazy(() => import('mf_auth/ChatAuthGate'));
const CLAVE_CONVERSACION = 'urbanpulse_chat_session_id';

function nuevoIdConversacion(usuarioId) {
  return `sesion-${usuarioId}-${idAleatorioSeguro()}`;
}

function idAleatorioSeguro() {
  if (window.crypto.randomUUID) return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function idConversacion(usuarioId) {
  try {
    const guardado = sessionStorage.getItem(`${CLAVE_CONVERSACION}:${usuarioId}`);
    if (guardado) return guardado;
  } catch {
    // sessionStorage no disponible (modo privado, etc.)
  }
  return renovarConversacion(usuarioId);
}

function renovarConversacion(usuarioId) {
  const nuevo = nuevoIdConversacion(usuarioId);
  try {
    sessionStorage.setItem(`${CLAVE_CONVERSACION}:${usuarioId}`, nuevo);
  } catch {
    // sessionStorage no disponible (modo privado, etc.)
  }
  return nuevo;
}

function olvidarConversacion(usuarioId) {
  try {
    sessionStorage.removeItem(`${CLAVE_CONVERSACION}:${usuarioId}`);
  } catch {
    // sessionStorage no disponible (modo privado, etc.)
  }
}

function mensajesDesdeHistorial(fila) {
  let historial = fila.historial_mensajes || [];
  if (typeof historial === 'string') {
    try {
      historial = JSON.parse(historial);
    } catch {
      historial = [];
    }
  }
  if (!Array.isArray(historial)) return [];

  const foto = fila.imagen_base64 ? `data:image/jpeg;base64,${fila.imagen_base64}` : null;
  const ultimoConFoto = historial.reduce(
    (indice, mensaje, i) => (mensaje.rol === 'ciudadano' && mensaje.imagen ? i : indice),
    -1
  );

  return historial.map((mensaje, i) => ({
    id: `historial-${i}`,
    sender: mensaje.rol === 'ciudadano' ? 'ciudadano' : 'urbanbot',
    text: mensaje.texto || '',
    image: i === ultimoConFoto ? foto : null,
    // HT-50 / T04: las respuestas del RAG se guardan con sus fuentes para volver a mostrarlas
    isRAG: mensaje.tipo === 'consulta',
    fuentes: Array.isArray(mensaje.fuentes) ? mensaje.fuentes : [],
    sinInformacion: mensaje.sin_informacion === true,
  }));
}

// ✨ NUEVO 3: Simplificamos la petición del historial usando fetchN8n
async function pedirHistorialChat(sessionId, usuarioId) {
  try {
    const endpoint = `/urbanpulse/chat-history?session_id=${encodeURIComponent(sessionId)}&usuario_id=${encodeURIComponent(usuarioId)}`;
    const datos = await fetchN8n(endpoint);
    
    const fila = Array.isArray(datos) ? datos[0] : datos;
    return fila && fila.session_id ? mensajesDesdeHistorial(fila) : [];
  } catch (error) {
    console.warn('No se pudo cargar el historial:', error);
    return [];
  }
}

// ✨ NUEVO 4: Simplificamos el guardado en el historial usando fetchN8n
function guardarTurnoEnHistorial(sessionId, usuarioId, mensajes) {
  if (!sessionId || !usuarioId || mensajes.length === 0) return;

  fetchN8n('/urbanpulse/chat-history-append', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, usuario_id: usuarioId, mensajes }),
  }).catch((error) => {
    console.warn('No se pudo guardar el turno en el historial:', error);
  });
}

function obtenerUbicacionActual() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: FALLBACK_LAT, lon: FALLBACK_LON });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve({ lat: FALLBACK_LAT, lon: FALLBACK_LON }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

export default function NLQCommandCenter() {
  const [session, setSession] = useState(getSession);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState(() => {
    const inicial = getSession();
    return inicial ? idConversacion(inicial.id) : null;
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);
  // Foto del reporte en curso: se muestra en el resumen y en la tarjeta de confirmación
  const imagenReporteRef = useRef(null);
  const conversacionesCargadas = useRef(new Set());

  useEffect(() => subscribeSession((nueva) => {
    setSession(nueva);
    setSessionId(nueva ? idConversacion(nueva.id) : null);
    if (!nueva) setMessages([]);
  }), []);

  useEffect(() => {
    if (!session || !sessionId) return undefined;
    if (conversacionesCargadas.current.has(sessionId)) return undefined;
    conversacionesCargadas.current.add(sessionId);

    let activo = true;
    pedirHistorialChat(sessionId, session.id)
      .then((delServidor) => {
        if (activo && delServidor.length) {
          setMessages((previos) => (previos.length === 0 ? delServidor : previos));
        }
      })
      .catch(() => {});

    return () => { activo = false; };
  }, [session, sessionId]);

  const handleAuth = (authData) => {
    saveSession(authData);
    setSession(authData);
    setSessionId(idConversacion(authData.id));
    setMessages([]);
  };

  const handleLogout = () => {
    if (session) olvidarConversacion(session.id);
    setMessages([]);
    setSessionId(null);
    clearSession();
    setSession(null);
  };

  if (!session) {
    return (
      <Suspense fallback={
        <div className="flex flex-col items-center justify-center h-full bg-[var(--color-bg-app)] text-[var(--color-accent)]">
          <div className="animate-spin h-8 w-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full mb-3"></div>
          <span className="text-sm font-medium">Cargando autenticación...</span>
        </div>
      }>
        <ChatAuthGate onAuth={handleAuth} />
      </Suspense>
    );
  }

  const getBase64 = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]); 
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    }
  };

  // textoForzado: lo usan los botones "Sí, enviar" / "Corregir" del resumen
  const handleSendMessage = async (e, textoForzado) => {
    if (e) e.preventDefault();

    const textoLimpio = (textoForzado ?? inputText).trim();
    if (!textoLimpio && !imagePreview) return;

    const textoUsuario = textoLimpio.toLowerCase();
    const conversacion = sessionId;

    const newUserMessage = {
      id: Date.now(),
      sender: 'ciudadano',
      text: textoLimpio,
      image: imagePreview
    };
    
    if (imagePreview) imagenReporteRef.current = imagePreview;

    setMessages(prev => [...prev, newUserMessage]);
    setInputText('');
    setIsAnalyzing(true);

    try {
      let imagenBase64 = null;
      if (fileInputRef.current && fileInputRef.current.files[0]) {
        imagenBase64 = await getBase64(fileInputRef.current.files[0]);
      }

      const { lat: latActual, lon: lonActual } = await obtenerUbicacionActual();

      const payload = {
        session_id: conversacion,
        usuario_id: session.id,
        mensaje: textoUsuario,
        imagen_base64: imagenBase64,
        latitude: latActual,
        longitude: lonActual
      };

      // ✨ NUEVO 5: Reemplazamos el fetch manual por tu cliente inteligente
      const mock = USAR_MOCK_RAG ? await respuestaMockConsulta(textoLimpio) : null;
      const data = mock ?? await fetchN8n('/urbanpulse/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // HT-50 / T04: una consulta vial (RAG) se muestra distinta a un reporte de incidente
      const esRAG = esConsulta(data);
      const fuentes = esRAG && Array.isArray(data.fuentes) ? data.fuentes : [];
      const sinInformacion = esRAG && data.sin_informacion === true;

      if (data.respuesta) {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          sender: 'urbanbot',
          text: data.respuesta,
          isRAG: esRAG,
          fuentes,
          sinInformacion,
          imagenReporte: imagenReporteRef.current,
        }]);
      }

      const ahora = new Date().toISOString();
      guardarTurnoEnHistorial(conversacion, session.id, [
        { rol: 'ciudadano', texto: textoLimpio, imagen: !!imagenBase64, at: ahora },
        ...(data.respuesta
          ? [{ rol: 'urbanbot', texto: data.respuesta, at: ahora, ...(esRAG && { tipo: 'consulta', fuentes, sin_informacion: sinInformacion }) }]
          : []),
      ]);

      if (!esRAG && data.estado === 'completado' && data.tipo_incidente) {
        const newBotMessage = {
          id: Date.now() + 2,
          sender: 'urbanbot',
          isStatusCard: true,
          ticketData: {
            id: Math.floor(Math.random() * 10000), 
            tipo: data.tipo_incidente,
            gravedad: `Prioridad ${data.prioridad} (Riesgo: ${data.score_riesgo})`,
            gps: `${latActual}, ${lonActual}`, 
            accion: 'Incidente registrado en sistema central'
          },
          imagenReporte: imagenReporteRef.current,
        };
        setMessages(prev => [...prev, newBotMessage]);
      }

      if (!esRAG && data.estado === 'completado') {
        imagenReporteRef.current = null;
        const siguiente = renovarConversacion(session.id);
        conversacionesCargadas.current.add(siguiente);
        setSessionId(siguiente);
      }

    } catch (error) {
      console.error("Error en la integración:", error);
      const errorMsg = {
        id: Date.now() + 1,
        sender: 'urbanbot',
        text: 'Lo siento, hubo un problema conectando con los servidores municipales. Intenta de nuevo en unos minutos.'
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsAnalyzing(false);
      setImagePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-app)] text-[var(--color-text-primary)] font-sans">
      
      <header className="bg-[var(--color-panel)] p-4 border-b border-[var(--color-border)] shadow-md flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <Bot className="text-[var(--color-accent)]" size={24} />
          <h1 className="text-xl font-bold tracking-wide">UrbanPulse <span className="text-[var(--color-accent)] font-normal">Command Center</span></h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--color-accent-light)] bg-[var(--color-accent-light)]/10 px-3 py-1 rounded-full border border-[var(--color-accent-light)]/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent-light)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-accent)]"></span>
            </span>
            {session.email || session.username}
          </div>
          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-red-400 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-secondary)]">
            <Bot size={48} className="mb-4 opacity-20" />
            <p>Reporta un incidente o consulta el estado vial de tu zona.</p>
            <p className="text-sm mt-1">Ej: &quot;Hay un bache gigante frente al parque.&quot;</p>
            <p className="text-sm mt-1">Ej: &quot;¿Es riesgoso circular por Ate en la mañana?&quot;</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.sender === 'ciudadano' ? 'flex-row-reverse' : ''}`}>
            
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border border-[var(--color-border)] ${msg.sender === 'ciudadano' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent-light)]' : 'bg-[var(--color-card)] text-[var(--color-accent)]'}`}>
              {msg.sender === 'ciudadano' ? <User size={16} /> : <Bot size={16} />}
            </div>

            <div className={`max-w-[80%] flex flex-col gap-2 ${msg.sender === 'ciudadano' ? 'items-end' : 'items-start'}`}>
              {msg.isRAG && <RespuestaRAG respuesta={msg.text} fuentes={msg.fuentes} sinInformacion={msg.sinInformacion} />}

              {!msg.isStatusCard && !msg.isRAG && msg.sender === 'urbanbot' && parsearResumen(msg.text) && (
                <ResumenReporte
                  resumen={parsearResumen(msg.text)}
                  imagen={msg.imagenReporte}
                  activo={!isAnalyzing && msg.id === messages[messages.length - 1]?.id}
                  onResponder={(valor) => handleSendMessage(null, valor)}
                />
              )}

              {!msg.isStatusCard && !msg.isRAG && !(msg.sender === 'urbanbot' && parsearResumen(msg.text)) && (
                <div className={`p-3 rounded-2xl border border-[var(--color-border)] shadow-sm ${msg.sender === 'ciudadano' ? 'bg-[var(--color-accent)]/10 text-[var(--color-text-primary)] rounded-tr-none' : 'bg-[var(--color-card)] text-[var(--color-text-secondary)] rounded-tl-none'}`}>
                  {msg.text && <p>{msg.text}</p>}
                  {msg.image && (
                    <img src={msg.image} alt="Reporte" className="mt-2 rounded-lg max-w-xs object-cover border border-[var(--color-border)]" />
                  )}
                </div>
              )}

              {msg.isStatusCard && (
                <div className="bg-[var(--color-card)] border-l-4 border-[var(--color-accent)] rounded-r-lg p-4 shadow-[0_4px_20px_rgba(168,85,247,0.1)] w-full max-w-sm mt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="text-[var(--color-accent)]" size={20} />
                    <h3 className="font-bold text-[var(--color-text-primary)]">Ticket #{msg.ticketData.id} Confirmado</h3>
                  </div>
                  {msg.imagenReporte && (
                    <img src={msg.imagenReporte} alt="Foto del incidente" className="mb-3 w-full max-h-40 rounded-lg object-cover border border-[var(--color-border)]" />
                  )}
                  <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                    <p className="flex justify-between border-b border-[var(--color-border)] pb-1">
                      <span>Tipo:</span> <span className="text-[var(--color-text-primary)]">{msg.ticketData.tipo}</span>
                    </p>
                    <p className="flex justify-between border-b border-[var(--color-border)] pb-1 items-center">
                      <span>Gravedad:</span> 
                      <span className="bg-red-900/30 text-red-400 border border-red-900/50 px-2 py-0.5 rounded flex items-center gap-1 font-semibold text-xs">
                        <AlertTriangle size={12} /> {msg.ticketData.gravedad}
                      </span>
                    </p>
                    <p className="flex justify-between border-b border-[var(--color-border)] pb-1">
                      <span>Coordenadas:</span> 
                      <span className="flex items-center gap-1 text-[var(--color-accent-light)] text-right max-w-[150px]"><MapPin size={12} className="shrink-0"/> {msg.ticketData.gps}</span>
                    </p>
                    <p className="flex justify-between pt-1">
                      <span>Acción:</span> <span className="text-[var(--color-accent)] text-right max-w-[150px]">{msg.ticketData.accion}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {isAnalyzing && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
              <Bot size={16} className="text-[var(--color-accent)]" />
            </div>
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-3 rounded-2xl rounded-tl-none flex items-center gap-3">
              <div className="animate-spin h-4 w-4 border-2 border-[var(--color-accent)] border-t-transparent rounded-full"></div>
              <span className="text-sm text-[var(--color-accent-light)] animate-pulse">Procesando con IA...</span>
            </div>
          </div>
        )}
      </main>

      <footer className="p-4 bg-[var(--color-panel)] border-t border-[var(--color-border)]">
        {imagePreview && (
          <div className="mb-3 relative inline-block">
            <img src={imagePreview} alt="Preview" className="h-20 rounded-lg border border-[var(--color-accent)] object-cover" />
            <button 
              onClick={() => setImagePreview(null)}
              className="absolute -top-2 -right-2 bg-[var(--color-card)] text-red-400 rounded-full p-1 border border-[var(--color-border)] hover:bg-[var(--color-border)] transition-colors"
            >
              ×
            </button>
          </div>
        )}

        <form onSubmit={handleSendMessage} className="flex gap-2 items-end">
          <button 
            type="button"
            onClick={() => fileInputRef.current.click()}
            className="p-3 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-card)] rounded-xl transition-colors shrink-0"
            title="Adjuntar fotografía"
          >
            <Camera size={24} />
          </button>
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleImageUpload}
          />
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isAnalyzing}
            placeholder="Reporta un incidente o haz una consulta vial..."
            className="flex-1 bg-[var(--color-card)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] px-4 py-3 rounded-xl border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50 transition-all"
          />
          <button 
            type="submit"
            disabled={(!inputText.trim() && !imagePreview) || isAnalyzing}
            className="p-3 bg-[var(--color-accent)] text-white rounded-xl hover:bg-[var(--color-accent-light)] transition-colors disabled:opacity-50 disabled:hover:bg-[var(--color-accent)] shrink-0 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
          >
            <Send size={20} />
          </button>
        </form>
      </footer>
    </div>
  );
}