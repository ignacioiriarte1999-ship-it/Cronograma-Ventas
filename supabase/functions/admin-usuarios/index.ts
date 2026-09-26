// ============================================================
//  EDGE FUNCTION: OPERACIONES DE ADMIN SOBRE CUENTAS
// ============================================================
// Resetear una contraseña y eliminar una cuenta necesitan auth.admin.*, que
// exige la clave service_role. Esa clave saltea todas las policies RLS, así
// que no puede salir del servidor: si estuviera en el navegador, cualquiera
// que abra las herramientas de desarrollo tendría la base entera.
//
// Por eso vive acá. La función la lee de la variable de entorno que Supabase
// ya le inyecta a toda Edge Function; no se escribe en ningún archivo del
// repositorio.
//
// Cada llamada verifica por su cuenta que quien la hace sea un admin activo.
// No alcanza con que la app sólo le muestre los botones al admin: cualquiera
// puede llamar a la URL con su propio token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const URL_PROYECTO = Deno.env.get('SUPABASE_URL')!;
const CLAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// El navegador pide permiso antes del POST. Ajustar a tu dominio si querés
// cerrarlo más: con '*' cualquier página puede llamar, pero sin un token de
// admin no consigue nada.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/**
 * Contraseña temporal legible: la tiene que poder dictar por teléfono quien
 * la resetea. Sin caracteres que se confundan (l/1/I, O/0).
 */
function passTemporal() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405);

  const autorizacion = req.headers.get('Authorization') || '';
  if (!autorizacion) return responder({ error: 'Falta la sesión.' }, 401);

  // Cliente con el token de quien llama: las policies se aplican tal cual, así
  // que sólo puede leer lo que le corresponde.
  const comoUsuario = createClient(URL_PROYECTO, CLAVE_ANON, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false },
  });

  const { data: sesion, error: errSesion } = await comoUsuario.auth.getUser();
  if (errSesion || !sesion?.user) return responder({ error: 'Sesión inválida.' }, 401);
  const quienLlama = sesion.user.id;

  const { data: perfil } = await comoUsuario
    .from('perfiles').select('rol, activo').eq('id', quienLlama).maybeSingle();

  if (!perfil || perfil.rol !== 'admin' || perfil.activo !== true) {
    return responder({ error: 'Hace falta ser administrador activo.' }, 403);
  }

  let cuerpo: { accion?: string; uid?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ error: 'Cuerpo inválido.' }, 400);
  }
  const { accion, uid } = cuerpo;
  if (!uid) return responder({ error: 'Falta el usuario.' }, 400);

  const admin = createClient(URL_PROYECTO, CLAVE_SERVICIO, { auth: { persistSession: false } });

  if (accion === 'reset') {
    const pass = passTemporal();
    const { error } = await admin.auth.admin.updateUserById(uid, { password: pass });
    if (error) return responder({ error: error.message }, 400);

    // Que la app lo obligue a cambiarla en el próximo ingreso.
    const { error: errPerfil } = await admin
      .from('perfiles').update({ pass_cambiada: false }).eq('id', uid);
    if (errPerfil) return responder({ error: errPerfil.message }, 400);

    return responder({ pass });
  }

  if (accion === 'eliminar') {
    // La misma regla que el trigger de la base, repetida acá para que el
    // mensaje sea claro en vez de un error de Postgres.
    if (uid === quienLlama) {
      return responder({ error: 'Un administrador no puede eliminar su propia cuenta.' }, 400);
    }
    // El perfil se va solo: perfiles.id referencia auth.users con on delete cascade.
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) return responder({ error: error.message }, 400);
    return responder({ ok: true });
  }

  return responder({ error: `Acción desconocida: ${accion}` }, 400);
});
