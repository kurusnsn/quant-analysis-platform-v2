# Build Stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["QuantPlatform.Gateway.csproj", "."]
RUN dotnet restore "./QuantPlatform.Gateway.csproj"
COPY . .
WORKDIR "/src/."
RUN dotnet build "QuantPlatform.Gateway.csproj" -c Release -o /app/build

# Publish Stage
FROM build AS publish
RUN dotnet publish "QuantPlatform.Gateway.csproj" -c Release -o /app/publish

# Final Stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
EXPOSE 8000

# Create non-root user
RUN groupadd -r gateway && useradd --no-log-init -r -g gateway gateway

# Copy with ownership
COPY --from=publish --chown=gateway:gateway /app/publish .

# Switch to non-root
USER gateway

ENTRYPOINT ["dotnet", "QuantPlatform.Gateway.dll"]
