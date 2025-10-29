# QueueBoard

Streamline your playlists, minimize clicks, and maximize flow.

QueueBoard is a single-page application that helps you organize and enjoy your favorite YouTube videos. It features a Trello-style interface for managing playlists, drag-and-drop functionality for easy organization, and seamless integration with the YouTube API.

## Features

*   **Trello-Style Playlists:** Organize your videos into playlists that are displayed as columns, similar to a Trello board.
*   **Drag-and-Drop:** Easily reorder videos within and between playlists using drag-and-drop.
*   **YouTube Integration:** Connect your YouTube account to import your existing playlists and videos.
*   **Responsive Design:** Enjoy a seamless experience on both desktop and mobile devices.
*   **Server-Side Rendering (SSR):** Get fast initial page loads and improved SEO with server-side rendering.

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

*   Node.js and npm
*   Angular CLI

### Installation

1.  Clone the repo
    ```sh
    git clone https://github.com/your_username/QueueBoard.git
    ```
2.  Navigate to the `queueboard` directory
    ```sh
    cd QueueBoard/queueboard
    ```
3.  Install NPM packages
    ```sh
    npm install
    ```
4.  Set up your YouTube API keys in `queueboard/src/env/environment.ts`. You will need a Google Client ID and a Google API Key. The file should look like this:

    ```typescript
    export const environment = {
      production: false,
      googleClientId: ''
      googleApiKey: '',
      pollingIntervalMinutes: 60
    };
    ```

### Running the Application

1.  Start the development server
    ```sh
    npm start
    ```
2.  Open your browser and navigate to `http://localhost:4200/`.

## Build

To build the project for production, run the following command:

```sh
ng build
```

The build artifacts will be stored in the `dist/` directory.

## Testing

To run the unit tests, use the following command:

```sh
npm test
```

## Technology Stack

*   [Angular](https://angular.io/)
*   [Angular Material](https://material.angular.io/)
*   [Bootstrap](https://getbootstrap.com/)
*   [Express.js](https://expressjs.com/)
*   [Jest](https://jestjs.io/)
*   [TypeScript](https://www.typescriptlang.org/)

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**. Just create a pull request!

## License

Distributed under the MIT License. See `LICENSE` for more information.
