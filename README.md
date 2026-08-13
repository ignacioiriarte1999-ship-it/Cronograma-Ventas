# Cronogramas — ContacCenter · Laprida 235

Aplicación web para armar, corregir y publicar los cronogramas de turnos de los
dos puntos de venta. El admin edita; cada vendedor entra y ve sólo sus turnos.

- **Período**: 06/07/2026 → 03/01/2027 (26 semanas)
- **Turnos**: mañana 8 a 14 · tarde 14 a 20 · sábado sólo mañana · domingo cerrado

---

## Puesta en marcha

Hace falta hacer esto **una sola vez**. Los pasos 1 a 4 son en la consola de
Firebase (https://console.firebase.google.com → proyecto `cronograma-ventas`).

### 1. Habilitar el login por contraseña

**Authentication → Sign-in method → Email/Password → Habilitar → Guardar.**

Sin esto la app muestra: *"Falta habilitar el proveedor Email/Contraseña"*.

### 2. Crear la cuenta del administrador

**Authentication → Users → Add user**

- Email: `admin@cronograma.local`
- Contraseña: la que elijas (mínimo 6 caracteres)

Copiá el **User UID** que aparece en la lista: lo necesitás en el paso siguiente.

### 3. Darle el rol de admin

**Realtime Database → Data**, y creá esta estructura reemplazando `UID_DEL_ADMIN`
por el UID que copiaste:

```
roles
 └── UID_DEL_ADMIN
      ├── user: "admin"
      ├── role: "admin"
      └── passChanged: true
```

Este paso se hace a mano porque es el único que no puede hacer la app: sin un
admin existente, nadie tiene permiso para crear el primero.

### 4. Publicar las reglas de seguridad

**Realtime Database → Rules**, pegá el contenido de
[`database.rules.json`](database.rules.json) y publicá.

Mientras tanto, **borrá el nodo `users`** si todavía existe: es de la versión
vieja y contiene hashes de contraseñas que ya no se usan.

> Con estas reglas publicadas, la base deja de ser accesible sin login. Antes,
> cualquiera con la URL podía leerla y escribirla entera con un `curl`.

### 5. Dar de alta a los vendedores

Entrá a la app como `admin`, abrí **⚙️ → Usuarios** y tocá
**"Crear los N usuarios faltantes"**. La app crea las 15 cuentas restantes y te
muestra la contraseña inicial de cada una para que se las repartas.

La contraseña inicial es `<apellido sin guiones>2026` — por ejemplo
`ortiz2026`, `desantis2026`, `delarosa2026`. **La app obliga a cambiarla en el
primer ingreso**, así que esa contraseña sirve una sola vez.

---

## Cómo se usa

### Vendedor

Entra con su apellido en minúsculas (`ortiz`, `de_santis`, `de_la_rosa`) y ve
dos pestañas: el cronograma de su punto de venta en **solo lectura**, y
**Mi horario** con su próximo turno, sus totales y el detalle mes a mes.

### Admin

Ve los dos cronogramas y puede editarlos:

- **Clic en una celda** rota el vendedor asignado a ese turno.
- **Feriados**: agregar o quitar. El día queda cerrado y el ciclo no se altera.
- **Corrector**: revisa las reglas de cada semana y propone los intercambios que
  las resuelven, para aprobarlos de a uno o todos juntos.
  *Revisar cambios recientes* saltea las semanas que no se tocaron desde la
  última revisión; *Revisar todo el semestre* fuerza el repaso completo.
- **Corregir automáticamente**: aplica en cadena las correcciones seguras hasta
  que no quedan más. Corta solo si detecta que dos reglas se pisan entre sí.
- **Exportar CSV** para imprimir o mandar por mail.

Todo cambio se sincroniza al instante en la pantalla de todos los conectados.

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
    ├── config.js       Config de Firebase, período, feriados, padrón
    ├── utils.js        Fechas, formato, escapado de HTML
    ├── firebase.js     Inicialización, conexión, alta aislada de cuentas
    ├── auth.js         Login, sesión, roles, alta de usuarios
    ├── schedule.js     Base común: persistencia, stats, edición, CSV
    ├── schedule-cc.js  ContacCenter: generador y reglas
    ├── schedule-lp.js  Laprida 235: generador y reglas
    ├── modules.js      Registro de cronogramas
    ├── corrector.js    Detección y aplicación de correcciones
    ├── render.js       Vistas de cronograma y "Mi horario"
    └── main.js         Arranque, pestañas, eventos, configuración

database.rules.json     Reglas de seguridad de la Realtime Database
firebase.json           Hosting y despliegue de reglas
legacy/                 Versión anterior de un solo archivo, como referencia
```

### Publicar

Con el CLI de Firebase (necesita Node.js instalado):

```bash
npm install -g firebase-tools && firebase login && firebase deploy
```

Alternativamente, subir el contenido de `public/` a cualquier hosting estático.

---

## Seguridad

- La identidad la maneja **Firebase Authentication**; el navegador ya no decide
  quién es admin.
- El rol vive en `/roles/$uid` y **sólo un admin puede escribirlo**. Cada usuario
  puede modificar un único campo del suyo: `passChanged`.
- Los cronogramas los **lee cualquier usuario logueado** y los **escribe sólo un
  admin** — verificado por el servidor en cada operación, no por la interfaz.
- Las contraseñas nunca pasan por la base: las guarda Firebase Auth con su
  propio hashing.
- Los nombres y motivos que tipea el admin se escapan antes de mostrarse.

La config de Firebase en `config.js` es pública por diseño: identifica al
proyecto, no autoriza nada. Lo que protege la base son las reglas.

### Tareas que quedan en la consola de Firebase

Resetear la contraseña de alguien o dar de baja una cuenta se hace desde
**Authentication → Users**. No se pueden hacer desde el navegador: el SDK web no
permite que un usuario opere sobre la cuenta de otro, y está bien que así sea.

Al dar de baja a alguien, borrá también su nodo en `/roles`.
