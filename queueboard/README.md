# Queueboard

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.3.4.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## Organizer (new)

This project now includes a basic Organizer page (Trello-style playlists and videos) under the route `/organizer`.

Added dependencies: `@angular/material`, `@angular/cdk`, and `gapi-script` for future YouTube API integration.

Quick setup after pulling changes:

1. Install new deps: `npm install`.
2. Import a Material theme in `src/styles.scss`, for example:

	@use '@angular/material' as mat;
	@include mat.core();
	$primary: mat.define-palette(mat.$indigo-palette);
	$accent: mat.define-palette(mat.$pink-palette, A200, A100, A400);
	$theme: mat.define-light-theme((color: (primary: $primary, accent: $accent)));
	@include mat.all-component-themes($theme);

3. Start dev server: `npm start`.

