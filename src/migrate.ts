import "dotenv/config";
import mysql from "mysql2/promise";

async function migrate() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  
  // Tabla de overrides de turno por día (para que el gerente modifique turnos individuales)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS turno_overrides (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empleado_id VARCHAR(100) NOT NULL,
      fecha VARCHAR(10) NOT NULL,
      turno VARCHAR(50) NOT NULL,
      trabaja BOOLEAN DEFAULT TRUE,
      notas TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_emp_fecha (empleado_id, fecha)
    )
  `);
  console.log("✅ turno_overrides created");

  // Tabla de documentos de empleados
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS documentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empleado_id VARCHAR(100) NOT NULL,
      nombre VARCHAR(255) NOT NULL,
      tipo ENUM('contrato', 'nomina', 'certificado', 'otro') DEFAULT 'otro',
      url TEXT NOT NULL,
      subido_por VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("✅ documentos created");

  // Tabla de lectura de avisos/mensajes
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS avisos_lectura (
      id INT AUTO_INCREMENT PRIMARY KEY,
      mensaje_id INT NOT NULL,
      empleado_id VARCHAR(100) NOT NULL,
      leido_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_msg_emp (mensaje_id, empleado_id)
    )
  `);
  console.log("✅ avisos_lectura created");

  // Añadir campo telefono a empleados si no existe
  try {
    await pool.execute(`ALTER TABLE empleados ADD COLUMN telefono VARCHAR(20) DEFAULT NULL`);
    console.log("✅ telefono column added to empleados");
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log("ℹ️ telefono column already exists");
    } else {
      console.log("⚠️ telefono:", e.message);
    }
  }

  // Añadir campo categoria a mensajes si no existe
  try {
    await pool.execute(`ALTER TABLE mensajes ADD COLUMN categoria ENUM('urgente', 'informativo', 'turno', 'general') DEFAULT 'general'`);
    console.log("✅ categoria column added to mensajes");
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log("ℹ️ categoria column already exists");
    } else {
      console.log("⚠️ categoria:", e.message);
    }
  }

  // Verificar que vacaciones existe
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS vacaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empleado_id VARCHAR(100) NOT NULL,
      fecha_inicio VARCHAR(10) NOT NULL,
      fecha_fin VARCHAR(10) NOT NULL,
      tipo ENUM('vacaciones', 'baja_medica', 'permiso', 'otro') DEFAULT 'vacaciones',
      motivo TEXT,
      estado ENUM('pendiente', 'aprobada', 'rechazada') DEFAULT 'pendiente',
      aprobado_por VARCHAR(100),
      dias_totales INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("✅ vacaciones verified");

  // Añadir campo dias_totales a vacaciones si no existe
  try {
    await pool.execute(`ALTER TABLE vacaciones ADD COLUMN dias_totales INT DEFAULT 0`);
    console.log("✅ dias_totales column added to vacaciones");
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log("ℹ️ dias_totales column already exists");
    } else {
      console.log("⚠️ dias_totales:", e.message);
    }
  }

  await pool.end();
  console.log("\n✅ Migration complete!");
}

migrate().catch(console.error);
