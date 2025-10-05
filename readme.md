# GraphQL Node

This is a basic GraphQL API built with Node.js, Express, and Apollo Server. It provides a simple and extensible structure to start developing modern APIs using GraphQL.

## 📦 Technologies Used

- **Node.js**
- **Express**
- **Apollo Server**
- **GraphQL**
- **Babel**
- **Nodemon**

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/luizcurti/graphql-node.git
cd graphql-node
```

2. Install dependencies:
```bash
npm install
```

## 🚀 Running the Project

To start the development server:
```bash
npm run dev
```

To start the JSON server (database):
```bash
npm run server
```

The GraphQL playground will be available at:
```bash
http://localhost:4000/graphql
```

## 🧪 Testing & Quality Assurance

```bash
# Run all tests
npm test

# Run ESLint
npm run lint

# Fix ESLint issues automatically
npm run lint:fix

# Run ESLint for CI (allows warnings)
npm run lint:ci

# Check code formatting
npm run format:check

# Format code automatically
npm run format

# Build the project
npm run build
```

## 🔧 Continuous Integration

This project uses GitHub Actions for CI/CD with the following workflows:

- **Code Quality**: ESLint linting and Prettier formatting checks
- **Testing**: Automated test execution on Node.js 22.x
- **Security**: npm audit for vulnerability scanning
- **Build**: Compilation check using Sucrase
- **Dependencies**: Automated updates via Dependabot

The CI pipeline runs on every push to `main` branch, as well as on pull requests to `main`.
