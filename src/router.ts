import { initTRPC } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import superjson from "superjson";
import { z } from "zod";
import mysql from "mysql2/promise";

// ============ CONTEXT ============
export function createContext(opts: CreateExpressContextOptions) {
  return { req: opts.req, res: opts.res };
}

type Context = Awaited<ReturnType<typeof createContext>>;

// ============ TRPC SETUP ============
const t = initTRPC.context<Context>().create({ transformer: superjson });
const router = t.router;
const publicProcedure = t.procedure;

// ============ DATABASE ============
let pool: mysql.Pool | null = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = mysql.createPool(process.env.DATABASE_URL);
  }
  return pool;
}

async function sql(query: string, params: any[] = []): Promise<any[]> {
  const p = getPool();
  if (!p) throw new Error("Database not available");
  const [rows] = await p.execute(query, params);
  return rows as any[];
}

// ============ EMPLEADOS ============
const empleadosRouter = router({
  list: publicProcedure.query(async () => {
    return await sql("SELECT * FROM empleados ORDER BY nombre");
  }),

  login: publicProcedure
    .input(z.object({ username: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      const rows = await sql(
        "SELECT * FROM empleados WHERE username = ? AND password = ? AND activo = TRUE",
        [input.username, input.password]
      );
      if (rows.length === 0) return { success: false, employee: null };
      return { success: true, employee: rows[0] };
    }),

  create: publicProcedure
    .input(z.object({
      id: z.string(),
      nombre: z.string(),
      username: z.string(),
      password: z.string(),
      rol: z.enum(["empleado", "gerente", "cocina"]),
      puesto: z.enum(["camarero", "cocina"]),
      turnoInicial: z.enum(["manana", "tarde"]),
      fechaInicio: z.string(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "INSERT INTO empleados (id, nombre, username, password, rol, puesto, turno_inicial, fecha_inicio, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)",
        [input.id, input.nombre, input.username, input.password, input.rol, input.puesto, input.turnoInicial, input.fechaInicio]
      );
      return { success: true };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      nombre: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      rol: z.enum(["empleado", "gerente", "cocina"]).optional(),
      puesto: z.enum(["camarero", "cocina"]).optional(),
      turnoInicial: z.enum(["manana", "tarde"]).optional(),
      fechaInicio: z.string().optional(),
      activo: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      const sets: string[] = [];
      const values: any[] = [];
      if (updates.nombre !== undefined) { sets.push("nombre = ?"); values.push(updates.nombre); }
      if (updates.username !== undefined) { sets.push("username = ?"); values.push(updates.username); }
      if (updates.password !== undefined) { sets.push("password = ?"); values.push(updates.password); }
      if (updates.rol !== undefined) { sets.push("rol = ?"); values.push(updates.rol); }
      if (updates.puesto !== undefined) { sets.push("puesto = ?"); values.push(updates.puesto); }
      if (updates.turnoInicial !== undefined) { sets.push("turno_inicial = ?"); values.push(updates.turnoInicial); }
      if (updates.fechaInicio !== undefined) { sets.push("fecha_inicio = ?"); values.push(updates.fechaInicio); }
      if (updates.activo !== undefined) { sets.push("activo = ?"); values.push(updates.activo); }
      if (sets.length === 0) return { success: false };
      values.push(id);
      await sql(`UPDATE empleados SET ${sets.join(", ")} WHERE id = ?`, values);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await sql("DELETE FROM empleados WHERE id = ?", [input.id]);
      return { success: true };
    }),

  changePassword: publicProcedure
    .input(z.object({ username: z.string(), oldPassword: z.string(), newPassword: z.string() }))
    .mutation(async ({ input }) => {
      const rows = await sql(
        "SELECT * FROM empleados WHERE username = ? AND password = ?",
        [input.username, input.oldPassword]
      );
      if (rows.length === 0) return { success: false, error: "Contraseña actual incorrecta" };
      await sql("UPDATE empleados SET password = ? WHERE username = ?", [input.newPassword, input.username]);
      return { success: true };
    }),
});

// ============ FICHAJES ============
const fichajesRouter = router({
  list: publicProcedure
    .input(z.object({
      fecha: z.string().optional(),
      empleadoId: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      let q = "SELECT * FROM fichajes";
      const conditions: string[] = [];
      const params: any[] = [];
      if (input?.fecha) { conditions.push("fecha = ?"); params.push(input.fecha); }
      if (input?.empleadoId) { conditions.push("empleado_id = ?"); params.push(input.empleadoId); }
      if (conditions.length > 0) q += " WHERE " + conditions.join(" AND ");
      q += " ORDER BY hora DESC";
      return await sql(q, params);
    }),

  registrar: publicProcedure
    .input(z.object({
      id: z.string(),
      empleadoId: z.string(),
      empleadoNombre: z.string(),
      fecha: z.string(),
      tipo: z.enum(["entrada", "salida"]),
      hora: z.string(),
      latitud: z.number().nullable().optional(),
      longitud: z.number().nullable().optional(),
      direccion: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      // Obtener todos los fichajes del día para este empleado
      const todayFichajes = await sql(
        "SELECT id, tipo, hora FROM fichajes WHERE empleado_id = ? AND fecha = ? ORDER BY hora ASC",
        [input.empleadoId, input.fecha]
      );
            const entradas = todayFichajes.filter((f: any) => f.tipo === 'entrada');
      const salidas = todayFichajes.filter((f: any) => f.tipo === 'salida');

      // Determinar si es cocinero (consultar puesto del empleado)
      const empRows = await sql("SELECT puesto FROM empleados WHERE id = ?", [input.empleadoId]);
      const esCocinero = empRows.length > 0 && empRows[0].puesto === 'cocina';
      const maxFichajes = esCocinero ? 2 : 1;

      // Verificar límites según puesto
      if (input.tipo === 'entrada' && entradas.length >= maxFichajes) {
        return { success: false, error: esCocinero ? 'Ya has fichado 2 entradas hoy (máximo turno partido)' : 'Ya has fichado entrada hoy' };
      }
      if (input.tipo === 'salida' && salidas.length >= maxFichajes) {
        return { success: false, error: esCocinero ? 'Ya has fichado 2 salidas hoy (máximo turno partido)' : 'Ya has fichado salida hoy' };
      }
      // Verificar secuencia lógica: entrada-salida-entrada-salida
      if (input.tipo === 'salida' && entradas.length <= salidas.length) {
        return { success: false, error: 'Debes fichar entrada antes de fichar salida' };
      }
      if (input.tipo === 'entrada' && entradas.length > salidas.length) {
        return { success: false, error: 'Debes fichar salida antes de una nueva entrada' };
      }

      await sql(
        "INSERT INTO fichajes (id, empleado_id, empleado_nombre, fecha, tipo, hora, latitud, longitud, direccion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [input.id, input.empleadoId, input.empleadoNombre, input.fecha, input.tipo, input.hora, input.latitud || null, input.longitud || null, input.direccion || null]
      );
      return { success: true };
    }),

  getByEmpleado: publicProcedure
    .input(z.object({ empleadoId: z.string() }))
    .query(async ({ input }) => {
      return await sql(
        "SELECT * FROM fichajes WHERE empleado_id = ? ORDER BY hora DESC",
        [input.empleadoId]
      );
    }),
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await sql("DELETE FROM fichajes WHERE id = ?", [input.id]);
      return { success: true };
    }),
  deleteByIds: publicProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      for (const id of input.ids) {
        await sql("DELETE FROM fichajes WHERE id = ?", [id]);
      }
      return { success: true, deleted: input.ids.length };
    }),
});

// ============ MENSAJES ============
const mensajesRouter = router({
  list: publicProcedure
    .input(z.object({ destinatarioId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      if (input?.destinatarioId) {
        return await sql(
          "SELECT * FROM mensajes WHERE destinatario_id = ? OR es_general = TRUE ORDER BY created_at DESC",
          [input.destinatarioId]
        );
      }
      return await sql("SELECT * FROM mensajes ORDER BY created_at DESC");
    }),

  send: publicProcedure
    .input(z.object({
      remitenteId: z.string(),
      destinatarioId: z.string().nullable(),
      esGeneral: z.boolean(),
      titulo: z.string(),
      contenido: z.string(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "INSERT INTO mensajes (remitente_id, destinatario_id, es_general, titulo, contenido) VALUES (?, ?, ?, ?, ?)",
        [input.remitenteId, input.destinatarioId, input.esGeneral, input.titulo, input.contenido]
      );
      return { success: true };
    }),

  markRead: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await sql("UPDATE mensajes SET leido = TRUE WHERE id = ?", [input.id]);
      return { success: true };
    }),

  unreadCount: publicProcedure
    .input(z.object({ destinatarioId: z.string() }))
    .query(async ({ input }) => {
      const rows = await sql(
        "SELECT COUNT(*) as count FROM mensajes WHERE (destinatario_id = ? OR es_general = TRUE) AND leido = FALSE",
        [input.destinatarioId]
      );
      return { count: rows[0]?.count || 0 };
    }),
});

// ============ SOLICITUDES DE CAMBIO ============
const solicitudesRouter = router({
  list: publicProcedure
    .input(z.object({ estado: z.string().optional() }).optional())
    .query(async ({ input }) => {
      if (input?.estado) {
        return await sql("SELECT * FROM solicitudes_cambio WHERE estado = ? ORDER BY created_at DESC", [input.estado]);
      }
      return await sql("SELECT * FROM solicitudes_cambio ORDER BY created_at DESC");
    }),

  create: publicProcedure
    .input(z.object({
      solicitanteId: z.string(),
      companeroId: z.string(),
      fechaTurno: z.string(),
      motivo: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "INSERT INTO solicitudes_cambio (solicitante_id, compañero_id, fecha_turno, motivo) VALUES (?, ?, ?, ?)",
        [input.solicitanteId, input.companeroId, input.fechaTurno, input.motivo]
      );
      return { success: true };
    }),

  respond: publicProcedure
    .input(z.object({
      id: z.number(),
      estado: z.enum(["aprobada", "rechazada"]),
      aprobadoPor: z.string(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "UPDATE solicitudes_cambio SET estado = ?, aprobado_por = ? WHERE id = ?",
        [input.estado, input.aprobadoPor, input.id]
      );
      return { success: true };
    }),

  getByEmpleado: publicProcedure
    .input(z.object({ empleadoId: z.string() }))
    .query(async ({ input }) => {
      return await sql(
        "SELECT * FROM solicitudes_cambio WHERE solicitante_id = ? OR compañero_id = ? ORDER BY created_at DESC",
        [input.empleadoId, input.empleadoId]
      );
    }),
});

// ============ VACACIONES ============
const vacacionesRouter = router({
  list: publicProcedure
    .input(z.object({ empleadoId: z.string().optional(), estado: z.string().optional() }).optional())
    .query(async ({ input }) => {
      let q = "SELECT * FROM vacaciones";
      const conditions: string[] = [];
      const params: any[] = [];
      if (input?.empleadoId) { conditions.push("empleado_id = ?"); params.push(input.empleadoId); }
      if (input?.estado) { conditions.push("estado = ?"); params.push(input.estado); }
      if (conditions.length > 0) q += " WHERE " + conditions.join(" AND ");
      q += " ORDER BY fecha_inicio DESC";
      return await sql(q, params);
    }),

  create: publicProcedure
    .input(z.object({
      empleadoId: z.string(),
      fechaInicio: z.string(),
      fechaFin: z.string(),
      tipo: z.enum(["vacaciones", "baja_medica", "permiso", "otro"]),
      motivo: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "INSERT INTO vacaciones (empleado_id, fecha_inicio, fecha_fin, tipo, motivo) VALUES (?, ?, ?, ?, ?)",
        [input.empleadoId, input.fechaInicio, input.fechaFin, input.tipo, input.motivo]
      );
      return { success: true };
    }),

  respond: publicProcedure
    .input(z.object({
      id: z.number(),
      estado: z.enum(["aprobada", "rechazada"]),
      aprobadoPor: z.string(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "UPDATE vacaciones SET estado = ?, aprobado_por = ? WHERE id = ?",
        [input.estado, input.aprobadoPor, input.id]
      );
      return { success: true };
    }),
});

// ============ ESTADÍSTICAS ============
const statsRouter = router({
  resumen: publicProcedure
    .input(z.object({
      fechaInicio: z.string(),
      fechaFin: z.string(),
      empleadoId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let q = `
        SELECT 
          empleado_id, 
          empleado_nombre,
          COUNT(CASE WHEN tipo = 'entrada' THEN 1 END) as dias_trabajados,
          MIN(CASE WHEN tipo = 'entrada' THEN hora END) as primera_entrada,
          MAX(CASE WHEN tipo = 'salida' THEN hora END) as ultima_salida
        FROM fichajes 
        WHERE fecha BETWEEN ? AND ?
      `;
      const params: any[] = [input.fechaInicio, input.fechaFin];
      if (input.empleadoId) {
        q += " AND empleado_id = ?";
        params.push(input.empleadoId);
      }
      q += " GROUP BY empleado_id, empleado_nombre";
      return await sql(q, params);
    }),

  horasPorEmpleado: publicProcedure
    .input(z.object({
      fechaInicio: z.string(),
      fechaFin: z.string(),
    }))
    .query(async ({ input }) => {
      const rows = await sql(`
        SELECT 
          e.empleado_id,
          e.empleado_nombre,
          e.fecha,
          MIN(CASE WHEN e.tipo = 'entrada' THEN e.hora END) as entrada,
          MAX(CASE WHEN e.tipo = 'salida' THEN e.hora END) as salida
        FROM fichajes e
        WHERE e.fecha BETWEEN ? AND ?
        GROUP BY e.empleado_id, e.empleado_nombre, e.fecha
        ORDER BY e.fecha DESC
      `, [input.fechaInicio, input.fechaFin]);
      return rows;
    }),
});

// ============ LISTA DE COMPRA ============
const shoppingRouter = router({
  list: publicProcedure
    .input(z.object({ completed: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      if (input?.completed !== undefined) {
        return await sql(
          "SELECT * FROM shopping_list WHERE completed = ? ORDER BY created_at DESC",
          [input.completed]
        );
      }
      return await sql("SELECT * FROM shopping_list ORDER BY completed ASC, created_at DESC");
    }),

  add: publicProcedure
    .input(z.object({
      item: z.string(),
      quantity: z.string().optional(),
      category: z.string().optional(),
      notes: z.string().optional(),
      addedBy: z.string(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "INSERT INTO shopping_list (item, quantity, category, notes, added_by) VALUES (?, ?, ?, ?, ?)",
        [input.item, input.quantity || '1', input.category || 'otros', input.notes || '', input.addedBy]
      );
      return { success: true };
    }),

  toggle: publicProcedure
    .input(z.object({
      id: z.number(),
      completed: z.boolean(),
      completedBy: z.string(),
    }))
    .mutation(async ({ input }) => {
      if (input.completed) {
        await sql(
          "UPDATE shopping_list SET completed = TRUE, completed_by = ?, completed_at = NOW() WHERE id = ?",
          [input.completedBy, input.id]
        );
      } else {
        await sql(
          "UPDATE shopping_list SET completed = FALSE, completed_by = NULL, completed_at = NULL WHERE id = ?",
          [input.id]
        );
      }
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await sql("DELETE FROM shopping_list WHERE id = ?", [input.id]);
      return { success: true };
    }),

  clearCompleted: publicProcedure
    .mutation(async () => {
      await sql("DELETE FROM shopping_list WHERE completed = TRUE");
      return { success: true };
    }),
});

// ============ RECETAS ============
const recetasRouter = router({
  list: publicProcedure
    .input(z.object({ categoria: z.string().optional() }).optional())
    .query(async ({ input }) => {
      if (input?.categoria) {
        return await sql("SELECT * FROM recetas WHERE categoria = ? ORDER BY nombre", [input.categoria]);
      }
      return await sql("SELECT * FROM recetas ORDER BY categoria, nombre");
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await sql("SELECT * FROM recetas WHERE id = ?", [input.id]);
      return rows[0] || null;
    }),

  create: publicProcedure
    .input(z.object({
      nombre: z.string(),
      categoria: z.string().optional(),
      ingredientes: z.string().optional(),
      instrucciones: z.string().optional(),
      tiempo_preparacion: z.number().optional(),
      notas: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "INSERT INTO recetas (nombre, categoria, ingredientes, instrucciones, tiempo_preparacion, notas) VALUES (?, ?, ?, ?, ?, ?)",
        [input.nombre, input.categoria || 'general', input.ingredientes || '', input.instrucciones || '', input.tiempo_preparacion || 0, input.notas || '']
      );
      return { success: true };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      nombre: z.string().optional(),
      categoria: z.string().optional(),
      ingredientes: z.string().optional(),
      instrucciones: z.string().optional(),
      tiempo_preparacion: z.number().optional(),
      notas: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const updates: string[] = [];
      const values: any[] = [];
      Object.entries(fields).forEach(([key, val]) => {
        if (val !== undefined) {
          updates.push(`${key} = ?`);
          values.push(val);
        }
      });
      if (updates.length > 0) {
        values.push(id);
        await sql(`UPDATE recetas SET ${updates.join(', ')} WHERE id = ?`, values);
      }
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await sql("DELETE FROM recetas WHERE id = ?", [input.id]);
      return { success: true };
    }),
});

// ============ TURNO OVERRIDES (modificación de turnos por día) ============
const turnoOverridesRouter = router({
  list: publicProcedure
    .input(z.object({ fecha: z.string().optional(), empleadoId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      let q = "SELECT * FROM turno_overrides";
      const conditions: string[] = [];
      const params: any[] = [];
      if (input?.fecha) { conditions.push("fecha = ?"); params.push(input.fecha); }
      if (input?.empleadoId) { conditions.push("empleado_id = ?"); params.push(input.empleadoId); }
      if (conditions.length > 0) q += " WHERE " + conditions.join(" AND ");
      q += " ORDER BY fecha DESC";
      return await sql(q, params);
    }),

  getByMonth: publicProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const startDate = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
      const endDate = `${input.year}-${String(input.month).padStart(2, '0')}-31`;
      return await sql(
        "SELECT * FROM turno_overrides WHERE fecha BETWEEN ? AND ?",
        [startDate, endDate]
      );
    }),

  set: publicProcedure
    .input(z.object({
      empleadoId: z.string(),
      fecha: z.string(),
      turno: z.string(),
      trabaja: z.boolean(),
      notas: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        `INSERT INTO turno_overrides (empleado_id, fecha, turno, trabaja, notas) 
         VALUES (?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE turno = VALUES(turno), trabaja = VALUES(trabaja), notas = VALUES(notas)`,
        [input.empleadoId, input.fecha, input.turno, input.trabaja, input.notas || null]
      );
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ empleadoId: z.string(), fecha: z.string() }))
    .mutation(async ({ input }) => {
      await sql("DELETE FROM turno_overrides WHERE empleado_id = ? AND fecha = ?", [input.empleadoId, input.fecha]);
      return { success: true };
    }),
});

// ============ DOCUMENTOS ============
const documentosRouter = router({
  list: publicProcedure
    .input(z.object({ empleadoId: z.string().optional(), tipo: z.string().optional() }).optional())
    .query(async ({ input }) => {
      let q = "SELECT * FROM documentos";
      const conditions: string[] = [];
      const params: any[] = [];
      if (input?.empleadoId) { conditions.push("empleado_id = ?"); params.push(input.empleadoId); }
      if (input?.tipo) { conditions.push("tipo = ?"); params.push(input.tipo); }
      if (conditions.length > 0) q += " WHERE " + conditions.join(" AND ");
      q += " ORDER BY created_at DESC";
      return await sql(q, params);
    }),

  upload: publicProcedure
    .input(z.object({
      empleadoId: z.string(),
      nombre: z.string(),
      tipo: z.enum(["contrato", "nomina", "certificado", "otro"]),
      url: z.string(),
      subidoPor: z.string(),
    }))
    .mutation(async ({ input }) => {
      await sql(
        "INSERT INTO documentos (empleado_id, nombre, tipo, url, subido_por) VALUES (?, ?, ?, ?, ?)",
        [input.empleadoId, input.nombre, input.tipo, input.url, input.subidoPor]
      );
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await sql("DELETE FROM documentos WHERE id = ?", [input.id]);
      return { success: true };
    }),
});

// ============ AVISOS LECTURA ============
const avisosLecturaRouter = router({
  marcarLeido: publicProcedure
    .input(z.object({ mensajeId: z.number(), empleadoId: z.string() }))
    .mutation(async ({ input }) => {
      await sql(
        "INSERT IGNORE INTO avisos_lectura (mensaje_id, empleado_id) VALUES (?, ?)",
        [input.mensajeId, input.empleadoId]
      );
      return { success: true };
    }),

  getLecturas: publicProcedure
    .input(z.object({ mensajeId: z.number() }))
    .query(async ({ input }) => {
      return await sql(
        "SELECT al.*, e.nombre as empleado_nombre FROM avisos_lectura al LEFT JOIN empleados e ON al.empleado_id = e.id WHERE al.mensaje_id = ?",
        [input.mensajeId]
      );
    }),

  getMisLecturas: publicProcedure
    .input(z.object({ empleadoId: z.string() }))
    .query(async ({ input }) => {
      return await sql(
        "SELECT mensaje_id FROM avisos_lectura WHERE empleado_id = ?",
        [input.empleadoId]
      );
    }),
});

// ============ RECORDATORIOS ============
const recordatoriosRouter = router({
  enviarWhatsApp: publicProcedure
    .input(z.object({
      telefono: z.string(),
      mensaje: z.string(),
      empleadoNombre: z.string(),
    }))
    .mutation(async ({ input }) => {
      // Generar enlace de WhatsApp (wa.me) para enviar mensaje
      const tel = input.telefono.replace(/[^0-9]/g, '');
      const waLink = `https://wa.me/${tel}?text=${encodeURIComponent(input.mensaje)}`;
      return { success: true, waLink, mensaje: input.mensaje };
    }),

  enviarSMS: publicProcedure
    .input(z.object({
      telefono: z.string(),
      mensaje: z.string(),
    }))
    .mutation(async ({ input }) => {
      // Para SMS real necesitarías Twilio u otro servicio
      // Por ahora generamos el enlace sms:
      const smsLink = `sms:${input.telefono}?body=${encodeURIComponent(input.mensaje)}`;
      return { success: true, smsLink, mensaje: input.mensaje };
    }),

  // Actualizar teléfono del empleado
  updateTelefono: publicProcedure
    .input(z.object({ empleadoId: z.string(), telefono: z.string() }))
    .mutation(async ({ input }) => {
      await sql("UPDATE empleados SET telefono = ? WHERE id = ?", [input.telefono, input.empleadoId]);
      return { success: true };
    }),
});

// ============ APP ROUTER ============
export const appRouter = router({
  app: router({
    empleados: empleadosRouter,
    fichajes: fichajesRouter,
    mensajes: mensajesRouter,
    solicitudes: solicitudesRouter,
    vacaciones: vacacionesRouter,
    stats: statsRouter,
    shopping: shoppingRouter,
    recetas: recetasRouter,
    turnos: turnoOverridesRouter,
    documentos: documentosRouter,
    avisosLectura: avisosLecturaRouter,
    recordatorios: recordatoriosRouter,
  }),
});

export type AppRouter = typeof appRouter;
