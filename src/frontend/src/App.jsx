import React, { useState, Suspense } from 'react';
import './App.css';
import '@tomtom-international/web-sdk-maps/dist/maps.css';

const MapaUrbano = React.lazy(() => import('mf_mapa_urbano/MapaUrbano'));
const Dashboard = React.lazy(() => import('mf_dashboard/Dashboard')); 
const WEBHOOK_URL = "http://localhost:5678/webhook/urbanpulse/report";

function App() {
  const [activeTab, setActiveTab] = useState('reporte');
  const [status, setStatus] = useState({ text: '', type: '', hidden: true });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState({ lat: '', lon: '' });

  // Función para obtener la geolocalización actual
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setStatus({ text: "Este navegador no soporta geolocalización.", type: "error", hidden: false });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lon: position.coords.longitude
        });
      },
      () => {
        setStatus({ text: "No se pudo obtener tu ubicación. Ingrésala manualmente.", type: "error", hidden: false });
      }
    );
  };

  // Convertir archivo a Base64 para enviarlo a Gemini
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Manejar el envío del formulario (¡AHORA CON FETCH REAL!)
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ hidden: true, text: "", type: "" });
    setResult(null); 

    try {
      const formElements = e.target.elements;

      // 1. Procesamos la imagen si el usuario subió una
      let imageBase64 = null;
      const imageFile = formElements.image.files[0];
      if (imageFile) {
        imageBase64 = await fileToBase64(imageFile);
      }

      // 2. Empaquetamos los datos exactos que espera el Backend
      const payload = {
        description: formElements.description.value,
        latitude: coords.lat ? parseFloat(coords.lat) : null,
        longitude: coords.lon ? parseFloat(coords.lon) : null,
        image_base64: imageBase64 // Se envía a Gemini para visión artificial
      };

      console.log("📡 [Data Interaction] Payload listo para enviar:", payload);

      // 3. El FETCH REAL (Conexión al Webhook de n8n)
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      // Verificamos si el servidor respondió con error (ej. CORS o servidor apagado)
      if (!response.ok) {
        throw new Error(`Error en el servidor: ${response.status}`);
      }

      // 4. Atrapamos la respuesta clasificada por Gemini desde n8n
      const data = await response.json();

      setResult(data); 
      setStatus({ hidden: false, text: "¡Reporte enviado y procesado con éxito!", type: "success" });
      
    } catch (error) {
      console.error("❌ Error en la conexión:", error);
      setStatus({ 
        hidden: false, 
        text: "Hubo un error al conectar con el servidor. Verifica que n8n esté corriendo y que CORS esté permitido.", 
        type: "error" 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <h1>UrbanPulse</h1>
      <p className="subtitle">Reporta un incidente urbano en tu zona.</p>

      {/* Navegación simple entre vistas del shell */}
      <nav className="tabs">
        <button
          type="button"
          className={activeTab === 'reporte' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('reporte')}
        >
          Reportar incidente
        </button>
        <button
          type="button"
          className={activeTab === 'dashboard' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={activeTab === 'mapa' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('mapa')}
        >
          Mapa
        </button>
      </nav>

      {activeTab === 'reporte' && (
      <>
      {/* Dashboard de métricas */}
      <div style={{ marginBottom: '2rem' }}>
        <Suspense fallback={<div style={{padding: '1rem', textAlign: 'center', background: '#f8f9fa', borderRadius: '8px'}}>Cargando métricas en tiempo real...</div>}>
          <Dashboard />
        </Suspense>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', gap: '2rem', alignItems: 'flex-start' }}>

        {/* LADO IZQUIERDO: Formulario */}
        <div style={{ flex: '0 0 400px' }}>
          <form id="report-form" onSubmit={handleSubmit}>
            <label htmlFor="description">Descripción del incidente</label>
            <textarea
              id="description"
              name="description"
              rows="4"
              placeholder="Ej: Hay un bache grande en la avenida principal..."
              required
            ></textarea>

            <label htmlFor="image">Foto (opcional)</label>
            <input id="image" name="image" type="file" accept="image/*" />

            <fieldset className="coords">
              <legend>Ubicación (opcional)</legend>
              <div className="coords-row">
                <div>
                  <label htmlFor="latitude">Latitud</label>
                  <input
                    id="latitude"
                    name="latitude"
                    type="number"
                    step="any"
                    placeholder="-12.0464"
                    value={coords.lat}
                    onChange={(e) => setCoords({ ...coords, lat: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="longitude">Longitud</label>
                  <input
                    id="longitude"
                    name="longitude"
                    type="number"
                    step="any"
                    placeholder="-77.0428"
                    value={coords.lon}
                    onChange={(e) => setCoords({ ...coords, lon: e.target.value })}
                  />
                </div>
              </div>
              <button type="button" id="use-location" onClick={handleGetLocation}>
                Usar mi ubicación actual
              </button>
            </fieldset>

            <button type="submit" id="submit-btn" disabled={loading}>
              {loading ? "Enviando..." : "Enviar reporte"}
            </button>
          </form>
        </div>

        {/* LADO DERECHO: Mapa */}
        <div style={{ flex: '1', minWidth: '500px', height: '600px', backgroundColor: '#e9e9e9', borderRadius: '8px', overflow: 'hidden' }}>
          <Suspense fallback={<div style={{padding: '2rem', textAlign:'center'}}>Cargando mapa de TomTom...</div>}>
            <MapaUrbano lat={coords.lat} lon={coords.lon} />
          </Suspense>
        </div>

      </div>

      <section id="status" className={`status ${status.type}`} hidden={status.hidden}>
        {status.text}
      </section>

      {result && (
        <section id="result" className="result">
          <p>Reporte procesado por Inteligencia Artificial.</p>
          <dl>
            <dt>Tipo de incidente</dt><dd>{result.incident_type ?? "-"}</dd>
            <dt>Gravedad</dt><dd>{result.severity ?? "-"}</dd>
            <dt>Prioridad</dt><dd>{result.priority ?? "-"}</dd>
            <dt>Estado</dt><dd>{result.status ?? "Registrado"}</dd>
            <dt>Mensaje</dt><dd>{result.mensaje_ciudadano ?? "-"}</dd>
          </dl>
        </section>
      )}
      </>
      )}

      {activeTab === 'dashboard' && (
        <Suspense fallback={<div style={{padding: '1rem', textAlign: 'center', background: '#f8f9fa', borderRadius: '8px'}}>Cargando métricas en tiempo real...</div>}>
          <Dashboard />
        </Suspense>
      )}

      {activeTab === 'mapa' && (
        <div style={{ height: '600px', borderRadius: '8px', overflow: 'hidden' }}>
          <Suspense fallback={<div style={{padding: '2rem', textAlign:'center'}}>Cargando mapa de TomTom...</div>}>
            <MapaUrbano lat={coords.lat} lon={coords.lon} />
          </Suspense>
        </div>
      )}
    </main>
  );
}

export default App;