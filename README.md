# RED NEXUS CLASSROOM v1.0

**Rama independiente.** No depende de `laboratorio-escolar` ni de NEXUS-X.

La meta de esta rama es una plataforma de aula digital tipo Classroom con Red Nexus como capa de conectividad/transferencia.

## Incluido en v1.0

### Aula
- Creación de aulas por docentes.
- Clave de 6 caracteres como método principal de ingreso.
- El QR no es obligatorio.
- Un alumno puede recibir la clave por pizarrón, chat o cualquier otro medio.
- Lista de integrantes y roles.

### Comunicación
- Anuncios.
- Chat de aula en tiempo real.
- Notificaciones.

### Actividades
- Crear actividades.
- Consigna.
- Fecha límite.
- Puntaje máximo.
- Registro de entregas.
- Calificación y retroalimentación.

### Organización
- Materiales.
- Calendario/eventos.
- Asistencia: presente, tarde, ausente, justificado.
- Dashboard con métricas.

### Red Nexus
- Mapa visual de integrantes.
- WebSocket de presencia/señalización.
- WebRTC DataChannel preparado para transferencia P2P.
- SHA-256 para identificar/verificar archivos.
- Arquitectura sin subir los bytes del archivo al servidor de señalización.

### Aplicación
- PWA instalable.
- Service Worker para caché básica.
- Responsive.

## Ejecutar

Requiere Node.js 18+.

```bash
npm install
npm start
```

Abrí:

`http://localhost:8080`

Para probar desde varios dispositivos, ejecutá el servidor en una PC accesible desde la misma red y entrá a la IP local de esa PC.

## Producción

Antes de publicar:

- `NEXUS_SECRET` debe ser un secreto largo y aleatorio.
- Usar HTTPS/WSS.
- Agregar autenticación con recuperación de cuenta y sesiones persistentes seguras.
- Añadir rate limiting y protección contra abuso.
- Migrar `data.json` a SQLite/PostgreSQL.
- Añadir TURN para redes donde WebRTC no pueda establecer P2P directo.
- Implementar almacenamiento de archivos para backup, si se desea.
- Separar permisos por aula y administrar roles desde el servidor.

## Importante sobre archivos

La v1.0 contiene la arquitectura P2P y la lógica de integridad, pero las entregas todavía registran metadata en la API. La transferencia de bytes debe cerrarse con el flujo de aceptación/rechazo, reanudación y almacenamiento/descarga P2P antes de considerarlo un sistema de producción.

## Roadmap posterior

- Transferencia real de entregas/materiales por P2P con UI de aceptación.
- Pausar/reanudar.
- Transferencia múltiple.
- TURN.
- Carpetas.
- Rúbricas.
- Calificaciones globales.
- Asistencia histórica.
- Calendario académico.
- Exportación CSV/PDF.
- Moderación.
- Administración de aulas.
- Modo offline avanzado y sincronización.


## Si aparece `Unexpected token '<', "<html>" is not valid JSON`

Ese mensaje significa que el frontend intentó llamar a `/api/...` pero recibió una página HTML en lugar de la respuesta JSON del backend. Es típico al abrir `index.html`/GitHub Pages sin tener conectado el servidor Node.

Soluciones:

1. **Prueba local completa:** ejecuta `npm install` y `npm start`, y abre `http://localhost:8080`.
2. **Frontend en GitHub Pages + backend separado:** en la pantalla de acceso, completa **Servidor API** con la URL pública de tu backend, por ejemplo `https://tu-backend.example.com`. El campo queda guardado en el navegador.
3. El backend expone `GET /api/health`; si responde JSON con `ok:true`, la conexión está correcta.
4. Para WebRTC desde redes escolares, HTTPS/WSS y un servidor TURN pueden ser necesarios.
