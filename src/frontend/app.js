// URL del webhook de n8n en producción. Coincide con el path
// "urbanpulse/report" configurado en el nodo Webhook de
// src/n8n-workflows/production/urbanpulse-report.json.
const N8N_WEBHOOK_URL = "https://urbanpulse-n8n.onrender.com/webhook/urbanpulse/report";

const form = document.getElementById("report-form");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const useLocationBtn = document.getElementById("use-location");
const latitudeInput = document.getElementById("latitude");
const longitudeInput = document.getElementById("longitude");

useLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showStatus("Este navegador no soporta geolocalización.", "error");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      latitudeInput.value = position.coords.latitude;
      longitudeInput.value = position.coords.longitude;
    },
    () => {
      showStatus("No se pudo obtener tu ubicación. Ingrésala manualmente.", "error");
    }
  );
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.hidden = false;
}

function hideStatus() {
  statusEl.hidden = true;
}

function showResult(report) {
  resultEl.innerHTML = `
    <p>Reporte enviado correctamente.</p>
    <dl>
      <dt>Tipo de incidente</dt><dd>${report.incident_type ?? "-"}</dd>
      <dt>Gravedad</dt><dd>${report.severity ?? "-"}</dd>
      <dt>Prioridad</dt><dd>${report.priority ?? "-"}</dd>
      <dt>Estado</dt><dd>${report.status ?? "-"}</dd>
      <dt>Mensaje</dt><dd>${report.mensaje_ciudadano ?? "-"}</dd>
    </dl>
  `;
  resultEl.hidden = false;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideStatus();
  resultEl.hidden = true;

  const description = document.getElementById("description").value.trim();
  if (!description) {
    showStatus("La descripción es obligatoria.", "error");
    return;
  }

  const imageFile = document.getElementById("image").files[0];
  const latitude = latitudeInput.value ? Number(latitudeInput.value) : null;
  const longitude = longitudeInput.value ? Number(longitudeInput.value) : null;

  const payload = { description, latitude, longitude };
  if (imageFile) {
    payload.image_base64 = await fileToBase64(imageFile);
  }

  submitBtn.disabled = true;
  showStatus("Enviando reporte...", "loading");

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`El servidor respondió con estado ${response.status}`);
    }

    const report = await response.json();
    hideStatus();
    if (report.error) {
      showStatus(report.error, "error");
      return;
    }
    showResult(report);
    form.reset();
  } catch (error) {
    showStatus(`No se pudo enviar el reporte: ${error.message}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
});
