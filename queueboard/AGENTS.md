# Agent Instructions for QueueBoard

This document provides comprehensive instructions for AI agents on how to interact with and contribute to the QueueBoard codebase.

## Project Overview

QueueBoard is a web application built with Angular. It uses TypeScript, SCSS for styling, and Jest for testing.

## Getting Started

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Run the Application (Development):**
    *   **Client-side only (SPA):** Useful for iterating on UI and component logic.
    ```bash
    npm start
    ```
    or
    ```bash
    npm run start:dev
    ```
    This will start a development server at `http://localhost:4200/`.
    *   **Server-side Rendering (SSR):** To run the full SSR server, you must first build the project.
        1.  Build: `ng build`
        2.  Serve SSR: `npm run serve:ssr:queueboard` (expects `dist/queueboard/server/server.mjs`)

## Core Technologies & Patterns

*   **Framework**: Angular (v21 preview) with standalone components.
*   **State Management**: Angular Signals are used for reactive state (e.g., `playlists = signal<...>([])`).
    *   **Signal Updates**: When modifying state, always prefer creating shallow copies of arrays/objects before calling `.set()` on the signal.
        *   *Example*: `const curr = [...this.playlists()]; curr[idx] = { ...curr[idx], videos: mapped }; this.playlists.set(curr);`
*   **Server-Side Rendering (SSR) Safety**: Guard any code using browser-specific globals (e.g., `window`, `localStorage`, `sessionStorage`) to prevent errors during SSR.
    *   *Example*: `if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;`
*   **API Integrations**:
    *   **YouTube**: Handled by `YoutubeApiService`. It loads Google's API scripts (`apis.google.com/js/api.js`, `accounts.google.com/gsi/client`) at runtime. Do not attempt static imports. Expects `environment.googleClientId` and `environment.googleApiKey`.
    *   **Spotify**: Handled by `SpotifyApiService`, which manages the OAuth 2.0 PKCE flow.
*   **Drag & Drop**: Implemented using the Angular CDK DragDrop module. Persistence of order is typically handled by `saveState()` writing to `localStorage`.

## Routing & Features

*   **Top-level Routes**: Defined in `queueboard/src/app/app.routes.ts`.
*   **Organizer Page**: Main application logic and UI at `/organizer` (`organizer.component.ts`).
*   **Transfer Page**: For moving playlists/songs between services at `/transfer` (`transfer.component.ts`).

## Important Files & References

*   **Routing**: `queueboard/src/app/app.routes.ts`
*   **App Configuration**: `queueboard/src/app/app.config.ts`, `queueboard/src/app/app.config.server.ts`
*   **Main Components**:
    *   `queueboard/src/app/organizer/organizer.component.ts`
    *   `queueboard/src/app/transfer/transfer.component.ts`
*   **Service Integrations**:
    *   `queueboard/src/app/services/youtube-api.service.ts`
    *   `queueboard/src/app/services/spotify-api.service.ts`
*   **Environment Variables**: `queueboard/src/env/environment.ts`
*   **SSR Entry Points**: `queueboard/src/main.server.ts`, `queueboard/src/server.ts` (Express handler)
*   **Angular CLI Config**: `queueboard/angular.json`, `queueboard/package.json`
*   **Testing Config**: `queueboard/jest.config.js`, `queueboard/setup-jest.ts`

## Coding Style and Conventions

This project uses Prettier to enforce a consistent code style. Please adhere to the following conventions:

*   **Line Width:** Maximum 135 characters.
*   **Quotes:** Use single quotes (`'`) for strings.
*   **Brackets:** Place brackets on the same line.
*   **Attributes:** Use a single attribute per line in HTML.
*   **TypeScript:**
    *   Strict mode is enabled.
    *   Use single quotes for strings.
    *   Follow the rules defined in `tsconfig.json`.

Before committing any changes, format your code using Prettier.

## Testing

The project uses Jest for unit testing.

*   **Run all tests:**
    ```bash
    npm test
    ```

*   **Run tests in watch mode:**
    ```bash
    npm run test:watch
    ```

*   **Run tests for CI:**
    ```bash
    npm run test:ci
    ```

*   **Generate test coverage report:**
    ```bash
    npm run test:coverage
    ```

Test files are located alongside the source files and have a `.spec.ts` extension.

## Building the Project

To create a production build of the application, run:

```bash
npm run build
```
The build artifacts (browser and server bundles) will be stored in the `dist/` directory.

## Submitting Changes

When making changes, please ensure the following:

*   **Adherence to Style**: Code must conform to the project's coding style and Prettier rules.
*   **Testing**: All existing tests must pass. New features or bug fixes should be accompanied by corresponding unit tests.
*   **Commit Messages**: Use clear and descriptive commit messages.
*   **Best Practices**: Follow coding best practices and encourage reuse of components/services where appropriate.

### Code Change Guidelines for AI Agents

*   **UI Changes**: Edit standalone components under `queueboard/src/app/*`. Update templates (`*.html`) and styles (`*.scss`) alongside TypeScript component logic.
*   **State Changes**: Follow the established signal pattern: obtain a shallow copy, mutate the copy, then call `.set(copy)` on the signal.
*   **Server/SSR Changes**: Be extremely careful with DOM or `window` usage. Always guard client-only code.
*   **External Secrets / Keys**: Do not hardcode new secrets into `environment.ts` or any other file in PRs. If credentials are required, document the environment variable or suggest a local `environment.local.ts` (and update `.gitignore`).

### What Not to Change Unless Requested

*   Do not replace the runtime loading of Google scripts with static imports.
*   Do not commit API keys or client IDs.

If anything is unclear or you need more specific details, ask for permission to inspect additional files or clarify the user's intended deployment target.
