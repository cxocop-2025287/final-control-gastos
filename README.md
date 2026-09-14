# Control de Gastos
## Descripción
Este proyecto consiste en una aplicación Web que pueda gestionar los gastos de los usuarios.Permite
llevar un control de ordenado de finanzas registrar deudas y ver un resumen con filtros por fecha y categoría.

La aplicación contiene

- Login: Permite ingresar a la aplicación y genera un token JWT
- Home: Dashbord funcional con información importante y gráficas
- Gastos: Apartado donde el usuario puede registrar los gastos y verlos
- Ingresos: Apartado para agregar ingresos, organizarlos y verlos
- Deudas: En este apartado puede agregar deudas y pagos a las deudas
- Resumen: Apartado para llevar un control de gastos e ingresos

## Tecnologías

Backend: Node.js, TypeScript, PostgreSQL, JSON Web Tokens  
Frontend Angular, TypeScript, HTML, CSS
Gestor de dependencias: pnpm

## Requisitos 

- Node.js (18 o superior)
- pnpm (8 o superior)
- PostgreSQL (14 o superior)

## Instalación

Pequeña guia de como instalar la aplicación de manera local
- Paso 1: Clonar el repositorio desde una terminal con el comando "git https://github.com/cxocop-2025287/control-de-gastos"
- Paso 2: Abir la carpeta con el comando "cd control-de-gastos" 
- Paso 3: Crear la base de datos de PostgreSQL: CREATE DATABASE control_de_gastos;
- Paso 4: Configurar la clase .env siguendo el ejemplo de .env.example
- Paso 5: Instalar las dependencias del backend con "cd back" y "pnpm install"
- Paso 6: Poblar la base de datos con "pnpm seed"
- Paso 7: Ejecutar y compilar con los comandos "pnpm build" y "pnpm start"
- Paso 8: Instalar las dependencias desde otra terminal del frontend con "cd front" y "pnpm install"
- Paso 8: Ejecutar el comando "pnpm start"
- Paso 9: Abrir [localhost:4000](http://localhost:4200/login) desde un navegador

## Estructura del proyecto

control-de-gastos/
├── back/
│   ├── src/
│   │   ├── config/         
│   │   ├── controllers/    
│   │   ├── middleware/     
│   │   ├── models/         
│   │   ├── routes/         
│   │   ├── seeds/           
│   │   ├── services/        
│   │   ├── types/          
│   │   ├── utils/          
│   │   ├── app.ts
│   │   └── server.ts
│   └── package.json
│
└── front/
    ├── src/app/
    │   ├── guards/         
    │   ├── interceptors/   
    │   ├── models/          
    │   ├── pages/           
    │   ├── services/       
    │   ├── app.routes.ts
    │   └── app.config.ts
    └── package.json