# admin-usuarios

Resetear una contraseña y eliminar una cuenta necesitan `auth.admin.*`, que
exige la clave `service_role`. Esa clave saltea todas las policies RLS, así que
**no puede estar en el navegador**: si estuviera en `config.js`, cualquiera que
abra las herramientas de desarrollo tendría la base entera.

Por eso esas dos operaciones viven acá. El resto de la gestión de usuarios
—cambiar rol, cambiar vendedor asociado, desactivar y reactivar— son updates
comunes sobre `perfiles` y los hace el navegador, porque las policies ya
limitan quién puede.

## Desplegar

```
supabase functions deploy admin-usuarios
```

No hace falta configurar ningún secreto: `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` se las inyecta Supabase a toda Edge Function.

Antes de desplegar, correr la migración `20260926_gestion_usuarios.sql`: la
función lee `perfiles.activo` para verificar que quien llama sea un admin
activo.

## Seguridad

Cada llamada verifica por su cuenta que quien la hace sea un administrador
activo. No alcanza con que la app sólo le muestre los botones al admin:
cualquiera puede llamar a la URL con su propio token.
