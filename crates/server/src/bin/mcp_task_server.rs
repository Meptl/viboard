use std::net::SocketAddr;

use rmcp::{
    ServiceExt,
    transport::{SseServer, stdio},
};
use server::mcp::task_server::TaskServer;
use tracing_subscriber::{EnvFilter, prelude::*};
use utils::port_file::read_port_file;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum McpTransport {
    Stdio,
    HttpSse,
}

#[derive(Debug, Clone)]
struct Args {
    transport: McpTransport,
    http_bind: SocketAddr,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            transport: McpTransport::Stdio,
            http_bind: "127.0.0.1:8788".parse().expect("valid default bind address"),
        }
    }
}

impl Args {
    fn parse() -> anyhow::Result<Self> {
        let mut args = Self::default();

        if let Ok(value) = std::env::var("MCP_TRANSPORT") {
            args.transport = parse_transport(&value)?;
        }
        if let Ok(value) = std::env::var("MCP_PORT") {
            let port = value
                .parse::<u16>()
                .map_err(|e| anyhow::anyhow!("Invalid MCP_PORT value '{}': {}", value, e))?;
            args.http_bind = SocketAddr::from(([127, 0, 0, 1], port));
        }
        if let Ok(value) = std::env::var("MCP_HTTP_BIND") {
            args.http_bind = value.parse().map_err(|e| {
                anyhow::anyhow!("Invalid MCP_HTTP_BIND value '{}': {}", value, e)
            })?;
        }

        let mut iter = std::env::args().skip(1);
        while let Some(arg) = iter.next() {
            if let Some(value) = arg.strip_prefix("--port=") {
                let port = value
                    .parse::<u16>()
                    .map_err(|e| anyhow::anyhow!("Invalid --port value '{}': {}", value, e))?;
                args.http_bind = SocketAddr::from(([127, 0, 0, 1], port));
                continue;
            }
            if arg == "--port" {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("Missing value for --port"))?;
                let port = value
                    .parse::<u16>()
                    .map_err(|e| anyhow::anyhow!("Invalid --port value '{}': {}", value, e))?;
                args.http_bind = SocketAddr::from(([127, 0, 0, 1], port));
                continue;
            }

            if let Some(value) = arg.strip_prefix("--transport=") {
                args.transport = parse_transport(value)?;
                continue;
            }
            if arg == "--transport" {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("Missing value for --transport"))?;
                args.transport = parse_transport(&value)?;
                continue;
            }

            if let Some(value) = arg.strip_prefix("--http-bind=") {
                args.http_bind = value.parse().map_err(|e| {
                    anyhow::anyhow!("Invalid --http-bind value '{}': {}", value, e)
                })?;
                continue;
            }
            if arg == "--http-bind" {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("Missing value for --http-bind"))?;
                args.http_bind = value.parse().map_err(|e| {
                    anyhow::anyhow!("Invalid --http-bind value '{}': {}", value, e)
                })?;
                continue;
            }

            if arg == "-h" || arg == "--help" {
                print_help();
                std::process::exit(0);
            }

            anyhow::bail!("Unknown argument: {arg}");
        }

        Ok(args)
    }
}

fn parse_transport(value: &str) -> anyhow::Result<McpTransport> {
    match value.to_ascii_lowercase().as_str() {
        "stdio" => Ok(McpTransport::Stdio),
        "http" | "sse" => Ok(McpTransport::HttpSse),
        other => anyhow::bail!("Invalid transport '{}'. Expected: stdio, http", other),
    }
}

fn print_help() {
    eprintln!(
        "mcp_task_server\n\
         \n\
         Options:\n\
           --port <PORT>              MCP listener port on 127.0.0.1 (default: 8788)\n\
           --transport <stdio|http>   MCP transport (default: stdio)\n\
           --http-bind <ADDR>         Advanced: bind address for HTTP/SSE transport (overrides --port)\n\
         \n\
         Environment:\n\
           MCP_TRANSPORT, MCP_PORT, MCP_HTTP_BIND, VIBE_BACKEND_URL, HOST, BACKEND_PORT, PORT"
    );
}

fn main() -> anyhow::Result<()> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let args = Args::parse()?;

            tracing_subscriber::registry()
                .with(
                    tracing_subscriber::fmt::layer()
                        .with_writer(std::io::stderr)
                        .with_filter(EnvFilter::new("debug")),
                )
                .init();

            let version = env!("CARGO_PKG_VERSION");
            tracing::debug!("[MCP] Starting MCP task server version {version}...");
            tracing::info!("[MCP] Transport: {:?}", args.transport);

            // Read backend port from port file or environment variable
            let base_url = if let Ok(url) = std::env::var("VIBE_BACKEND_URL") {
                tracing::info!("[MCP] Using backend URL from VIBE_BACKEND_URL: {}", url);
                url
            } else {
                let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

                // Get port from environment variables or fall back to port file
                let port = match std::env::var("BACKEND_PORT").or_else(|_| std::env::var("PORT")) {
                    Ok(port_str) => {
                        tracing::info!("[MCP] Using port from environment: {}", port_str);
                        port_str.parse::<u16>().map_err(|e| {
                            anyhow::anyhow!("Invalid port value '{}': {}", port_str, e)
                        })?
                    }
                    Err(_) => {
                        let port = read_port_file("vibe-kanban").await?;
                        tracing::info!("[MCP] Using port from port file: {}", port);
                        port
                    }
                };

                let url = format!("http://{}:{}", host, port);
                tracing::info!("[MCP] Using backend URL: {}", url);
                url
            };

            match args.transport {
                McpTransport::Stdio => {
                    let service = TaskServer::new(&base_url)
                        .init()
                        .await
                        .serve(stdio())
                        .await
                        .map_err(|e| {
                            tracing::error!("serving error: {:?}", e);
                            e
                        })?;

                    service.waiting().await?;
                }
                McpTransport::HttpSse => {
                    let service = TaskServer::new(&base_url).init().await;
                    let sse_server = SseServer::serve(args.http_bind).await?;
                    tracing::info!(
                        "[MCP] HTTP/SSE MCP server listening on http://{} (SSE: /sse, POST: /message)",
                        args.http_bind
                    );
                    let shutdown = sse_server.with_service(move || service.clone());
                    tokio::signal::ctrl_c().await?;
                    tracing::info!("[MCP] Received shutdown signal, stopping HTTP/SSE MCP server");
                    shutdown.cancel();
                }
            }
            Ok(())
        })
}
