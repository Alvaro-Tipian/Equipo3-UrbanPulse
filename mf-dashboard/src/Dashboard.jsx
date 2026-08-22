
const Dashboard = () => {
  return (
    <div style={{ padding: '1.5rem', backgroundColor: '#f8f9fa', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
      <h2 style={{ margin: '0 0 1.5rem 0', color: '#333', fontSize: '1.25rem' }}>📊 Métricas de la Zona (Tiempo Real)</h2>
      
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between' }}>
        {/* Tarjeta 1 */}
        <div style={{ flex: 1, padding: '1rem', background: 'white', borderLeft: '4px solid #0d6efd', borderRadius: '6px' }}>
          <h3 style={{ margin: 0, color: '#6c757d', fontSize: '0.85rem', textTransform: 'uppercase' }}>Reportes Hoy</h3>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.8rem', fontWeight: 'bold', color: '#212529' }}>24</p>
        </div>
        
        {/* Tarjeta 2 */}
        <div style={{ flex: 1, padding: '1rem', background: 'white', borderLeft: '4px solid #dc3545', borderRadius: '6px' }}>
          <h3 style={{ margin: 0, color: '#6c757d', fontSize: '0.85rem', textTransform: 'uppercase' }}>Gravedad Alta</h3>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.8rem', fontWeight: 'bold', color: '#212529' }}>5</p>
        </div>
        
        {/* Tarjeta 3 */}
        <div style={{ flex: 1, padding: '1rem', background: 'white', borderLeft: '4px solid #ffc107', borderRadius: '6px' }}>
          <h3 style={{ margin: 0, color: '#6c757d', fontSize: '0.85rem', textTransform: 'uppercase' }}>Zonas Críticas</h3>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.8rem', fontWeight: 'bold', color: '#212529' }}>3</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;