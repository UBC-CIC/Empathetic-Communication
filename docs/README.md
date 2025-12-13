# Emotional App

A modern, minimalistic social media application built with .NET MAUI for iOS and Android.

## Features

- 📱 Cross-platform support (iOS and Android)
- 🎨 Modern purple-themed UI design
- 📸 Image and video post feed
- 🔄 Pull-to-refresh functionality
- 💜 Minimalistic and clean interface
- 📊 Placeholder feed data (ready for API integration)

## Design Philosophy

The app features a modern, minimalistic design with a distinctive purple color scheme (#9C27B0). The UI is designed to provide a familiar social media experience while maintaining its own unique visual identity.

### Key Design Elements

- Dark theme (#121212 background) for better viewing experience
- Purple accents for brand identity
- Card-based post layout
- Circular user avatars with purple borders
- Clean typography using Open Sans font family

## Architecture

The application follows the MVVM (Model-View-ViewModel) pattern:

- **Models**: `Post` - Represents social media posts with properties like username, image, caption, likes, and comments
- **Services**: `PlaceholderFeedService` - Provides mock data for the initial release (ready to be replaced with API calls)
- **ViewModels**: `FeedViewModel` - Manages feed state and user interactions
- **Views**: `FeedPage` - Displays the scrollable feed of posts

## Building the App

### Prerequisites

- .NET 10 SDK
- MAUI workloads installed
- Android SDK (for Android builds)
- Xcode (for iOS builds on macOS)

### Build Instructions

#### Android
```bash
dotnet build -f net10.0-android
```

#### iOS (macOS only)
```bash
dotnet build -f net10.0-ios
```

## Future Enhancements

- Integration with backend API
- User authentication
- Post creation functionality
- Comments and likes interaction
- Video playback support
- User profiles
- Direct messaging
- Stories feature

## Technology Stack

- .NET MAUI 10
- C# 12
- XAML for UI
- Dependency Injection
- Observable Collections for data binding

## License

This project is open source and available under the MIT License.
