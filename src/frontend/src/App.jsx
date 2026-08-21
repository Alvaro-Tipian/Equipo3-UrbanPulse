import React, { useState, Suspense } from 'react';
import './App.css';
import '@tomtom-international/web-sdk-maps/dist/maps.css';
const MapaUrbano = React.lazy(() => import('mf_mapa_urbano/MapaUrbano'));
const WEBHOOK_URL = "http://localhost:5678/webhook/urbanpulse/report";

function App() {
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

  // Convertir archivo a Base64
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

  // Manejar el envío del formulario
  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ text: '', type: '', hidden: true });
    setResult(null);

    const description = event.target.description.value.trim();
    if (!description) {
      setStatus({ text: "La descripción es obligatoria.", type: "error", hidden: false });
      return;
    }

    const imageFile = event.target.image.files[0];
    const latitude = coords.lat ? Number(coords.lat) : null;
    const longitude = coords.lon ? Number(coords.lon) : null;

    const payload = { description, latitude, longitude };
    if (imageFile) {
      payload.image_base64 = await fileToBase64(imageFile);
    }

    setLoading(true);
    setStatus({ text: "Enviando reporte...", type: "loading", hidden: false });

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`El servidor respondió con estado ${response.status}`);
      }

      const report = await response.json();
      setStatus({ text: '', type: '', hidden: true });

      if (report.error) {
        setStatus({ text: report.error, type: "error", hidden: false });
        return;
      }

      setResult(report);
      event.target.reset();
      setCoords({ lat: '', lon: '' });
    } catch (error) {
      setStatus({ text: `No se pudo enviar el reporte: ${error.message}`, type: "error", hidden: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    // Ampliamos el contenedor principal para que tenga espacio suficiente
    <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <h1>UrbanPulse</h1>
      <p className="subtitle">Reporta un incidente urbano en tu zona.</p>

      {/* Contenedor Flex: flexDirection 'row' fuerza izquierda/derecha */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '2rem', alignItems: 'flex-start' }}>
        
        {/* LADO IZQUIERDO: Formulario (Ancho fijo de 400px) */}
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

        {/* LADO DERECHO: Mapa (Toma todo el espacio restante con flex: 1) */}
        <div style={{ flex: '1', minWidth: '500px', height: '600px', backgroundColor: '#e9e9e9', borderRadius: '8px', overflow: 'hidden' }}>
          <Suspense fallback={<div style={{padding: '2rem', textAlign:'center'}}>Cargando mapa de TomTom...</div>}>
            {/* Le enviamos la latitud y longitud como props */}
            <MapaUrbano lat={coords.lat} lon={coords.lon} />
          </Suspense>
        </div>

      </div>

      <section id="status" className={`status ${status.type}`} hidden={status.hidden}>
        {status.text}
      </section>

      {result && (
        <section id="result" className="result">
          <p>Reporte enviado correctamente.</p>
          <dl>
            <dt>Tipo de incidente</dt><dd>{result.incident_type ?? "-"}</dd>
            <dt>Gravedad</dt><dd>{result.severity ?? "-"}</dd>
            <dt>Prioridad</dt><dd>{result.priority ?? "-"}</dd>
            <dt>Estado</dt><dd>{result.status ?? "-"}</dd>
            <dt>Mensaje</dt><dd>{result.mensaje_ciudadano ?? "-"}</dd>
          </dl>
        </section>
      )}
    </main>
  );
}

export default App;