# Cronogramas — ContacCenter · Laprida 235

Aplicación web para armar, corregir y publicar los cronogramas de turnos de los
dos puntos de venta. El admin edita; cada vendedor entra y ve sólo sus turnos.

- **Período**: 06/07/2026 → 03/01/2027 (26 semanas)
- **Turnos**: mañana 8 a 14 · tarde 14 a 20 · sábado sólo mañana · domingo cerrado
- **Stack**: Supabase (Postgres + Auth + Realtime) y ES modules nativos, sin build

---

## Puesta en marcha

Hace falta hacer esto **una sola vez**.

### 1. Crear el proyecto en Supabase

En https://supabase.com → **New project**. Elegí la región más cercana
(São Paulo) y guardate la contraseña de la base que te pide, aunque la app no
la use.

### 2. Crear las tablas

**SQL Editor → New query**, pegá todo el contenido de
[`supabase/schema.sql`](supabase/schema.sql) y ejecutá.

Eso crea las tablas, las policies RLS, la publicación de Realtime y siembra los
dos puntos de venta, los 15 vendedores y los feriados de 2026. El script es
idempotente: se puede volver a correr sin romper nada.

### 3. Desactivar la confirmación por email

**Authentication → Providers → Email** → desactivar **"Confirm email"**.

Los vendedores no tienen casilla corporativa, así que la app les arma un email
sintético (`ortiz@cronograma.local`). Si Supabase espera una confirmación, ese
mail no llega a ningún lado y nadie puede entrar.

### 4. Configurar la app

**Settings → API**, copiá **Project URL** y la clave **anon / public**, y
pegalas en [`public/js/config.js`](public/js/config.js):

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGci...';
```

Ambas son públicas por diseño: identifican al proyecto y no autorizan nada por
sí solas. Lo que protege los datos son las policies RLS. **Nunca** pongas acá la
`service_role key`, que sí saltea todas las policies.

### 5. Crear el usuario administrador

**Authentication → Users → Add user**

- Email: `admin@cronograma.local` — el nombre antes de la `@` es el usuario
  con el que vas a entrar. Si preferís `ignacio`, poné `ignacio@cronograma.local`.
- Contraseña: la que elijas (mínimo 6 caracteres)
- Marcá **Auto Confirm User**

Listo, ya es admin: un trigger del schema convierte en administrador al primer
usuario que se dé de alta, porque hasta que exista uno las policies no
autorizan a nadie a crear el primero. A partir de ahí el trigger no vuelve a
actuar y las altas siguientes salen por la app.

### 6. Dar de alta a los vendedores

Entrá a la app como `admin`, abrí **⚙️ → Usuarios** y tocá
**"Crear los N usuarios faltantes"**. La app crea las 15 cuentas restantes y te
muestra la contraseña inicial de cada una para que se las repartas.

La contraseña inicial es `<apellido sin guiones>2026` — por ejemplo
`ortiz2026`, `desantis2026`, `delarosa2026`. **La app obliga a cambiarla en el
primer ingreso**, así que sirve una sola vez.

La primera vez que entra el admin, si la tabla `turnos` está vacía, la app
genera y guarda el cronograma de los dos puntos de venta automáticamente.

---

## Cómo se usa

### Vendedor

Entra con su apellido en minúsculas (`ortiz`, `de_santis`, `de_la_rosa`) y ve
dos pestañas: el cronograma de su punto de venta en **solo lectura**, y
**Mi horario** con su próximo turno, sus totales y el detalle mes a mes.

### Admin

Ve los dos cronogramas y puede editarlos:

- **Clic en una celda** rota el vendedor asignado a ese turno.
- **Feriados**: agregar o quitar. El día queda cerrado y libera sus turnos.
- **Corrector**: revisa las reglas de cada semana y propone los intercambios que
  las resuelven, para aprobarlos de a uno o todos juntos.
  *Revisar cambios recientes* saltea las semanas que no se tocaron desde la
  última revisión; *Revisar todo el semestre* fuerza el repaso completo.
- **Corregir automáticamente**: aplica en cadena las correcciones seguras hasta
  que no quedan más. Corta solo si detecta que dos reglas se pisan entre sí.
- **Exportar CSV** para imprimir o mandar por mail.

Todo cambio aparece al instante en la pantalla de los demás conectados, vía
Supabase Realtime.

---

## Reglas de cada cronograma

### ContacCenter — 3 vendedores

Ciclo de 3 semanas que rota quién cierra:

| Tipo | Abre (lunes mañana) | Cierra (sábado mañana) |
|------|---------------------|------------------------|
| A    | Imbaud              | Ortiz                  |
| B    | Ortiz               | De Santis              |
| C    | De Santis           | Imbaud                 |

- **Imbaud**: 3 turnos por semana (2 mañanas + 1 tarde). El sábado cuenta como
  mañana en las semanas que cierra.
- **Ortiz y De Santis**: 4 turnos cada uno, siempre.
- **Regla del cierre**: quien cierra el sábado abre el lunes siguiente.
- Nadie cubre mañana y tarde del mismo día.
- Los días puntuales rotan entre 12 patrones, para que nadie quede atado a una
  franja fija (por ejemplo, siempre viernes a la mañana).

Sobre el semestre esto da **9 / 9 / 8 sábados** para Ortiz, De Santis e Imbaud.

Las semanas del **03/08, 10/08 y 17/08** están fijadas contra las capturas
reales: el generador las respeta tal cual y el corrector no las cuestiona.

### Laprida 235 — 12 vendedores

Cola cíclica de 12 sobre 11 slots semanales (L-M, L-T, Ma-M, Ma-T, Mi-M, Mi-T,
J-M, J-T, V-M, V-T, S-M). La cola avanza +1 por semana, así que **cada semana
descansa uno distinto** y con el correr del semestre todos pasan por todas las
franjas.

Dos correcciones respecto del cronograma en papel:

- "Díaz" y "Diaz" eran la misma persona: quedó un solo nombre.
- Juarez no tenía asignado ningún sábado; ahora le tocan 2, como a todos.

---

## Desarrollo

No hay build ni dependencias: son ES modules nativos que corren directo en el
navegador. Pero **sí hace falta un servidor local** — abrir el `index.html` con
doble clic no funciona, porque el navegador bloquea los módulos sobre `file://`.

```bash
python3 -m http.server 8123 --directory public
```

Y entrar a http://localhost:8123.

### Estructura

```
public/
├── index.html          Estructura de la página (sin lógica)
├── css/styles.css
└── js/
    ├── config.js       Credenciales de Supabase, período, padrón
    ├── utils.js        Fechas, formato, escapado de HTML
    ├── periodo.js      El semestre y su esqueleto
    ├── reglas-cc.js    ContacCenter: generador y reglas   ← lógica pura
    ├── reglas-lp.js    Laprida 235: generador y reglas    ← lógica pura
    ├── db.js           Cliente de Supabase y estado de conexión
    ├── auth.js         Login, sesión, roles, alta de usuarios
    ├── schedule.js     Persistencia, stats, edición, CSV
    ├── modules.js      Une las reglas con la persistencia
    ├── corrector.js    Detección y aplicación de correcciones
    ├── render.js       Vistas de cronograma y "Mi horario"
    └── main.js         Arranque, pestañas, eventos, configuración

supabase/schema.sql     Tablas, policies RLS, Realtime y datos iniciales
legacy/                 Versión monolítica original, como referencia
```

`reglas-cc.js` y `reglas-lp.js` no importan `db.js` ni `schedule.js`: son
funciones puras. Eso permite ejecutarlas y verificarlas sin conexión ni sesión
—útil para comprobar que un cambio en las reglas no rompe el reparto.

### Publicar

El contenido de `public/` es estático: sirve cualquier hosting (Netlify, Vercel,
Cloudflare Pages, GitHub Pages).

---

## Modelo de datos

| Tabla | Qué guarda |
|---|---|
| `puntos_venta` | `cc` y `lp`, con sus horarios |
| `vendedores` | Nombre y orden dentro de cada punto de venta |
| `perfiles` | Extiende `auth.users` con usuario, rol y vendedor asociado |
| `turnos` | **Una fila por turno asignado** (`punto_venta`, `fecha`, `turno`) |
| `feriados` | Fecha y motivo, por punto de venta |
| `historial` | Correcciones aplicadas y rechazadas, con autor |
| `revisiones` | Huella de la última revisión de cada semana |

Los domingos no se guardan: se derivan por código. Un slot sin fila es un turno
vacío.

**Por qué una fila por turno y no un JSON**: un clic en una celda actualiza una
fila, no el semestre entero. Además de ser más liviano, evita que dos admins
editando a la vez se pisen —que es lo que pasaba con el diseño anterior, donde
la última escritura sobrescribía todo sin aviso.

---

## Seguridad

- La identidad la maneja **Supabase Auth**; el navegador no decide quién es
  admin.
- El rol vive en `perfiles` y las **policies RLS** lo verifican en cada consulta.
  El patrón es: lee cualquier usuario autenticado, escribe sólo el admin.
- Un vendedor sólo puede modificar `pass_cambiada` de su propio perfil. Un
  trigger bloquea que se cambie el rol a sí mismo.
- La función `es_admin()` es `SECURITY DEFINER` a propósito: si consultara
  `perfiles` bajo RLS, las policies se llamarían a sí mismas y Postgres cortaría
  por recursión.
- Las contraseñas nunca pasan por las tablas: las guarda Supabase Auth.
- Los nombres y motivos que tipea el admin se escapan antes de mostrarse.

### Tareas que quedan en el panel de Supabase

Resetear la contraseña de alguien o dar de baja una cuenta se hace desde
**Authentication → Users**. No se pueden hacer desde el navegador: requieren la
`service_role key`, que jamás debe estar en el código del cliente.

Al dar de baja a alguien, su fila en `perfiles` se borra sola (`on delete
cascade`).

### Si el proyecto se pausa

El plan gratuito de Supabase **pausa los proyectos tras 7 días sin actividad**;
hay que despertarlos desde el panel. Con uso diario no debería pasar, pero si la
app aparece caída un lunes, mirá eso primero.
