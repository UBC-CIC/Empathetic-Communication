import asyncio
import json
import sys
import os
import socketio

sys.path.append('/app')
from nova_boto3 import NovaSonic

async def run_nova():
    # 1) Socket.IO client
    socket_url = os.getenv("SOCKET_URL")
    socket_client = None
    if socket_url:
        print(f"Using socket URL: {socket_url}")
        ssl_verify = os.getenv("SSL_VERIFY", "true").lower() != "false"
        socket_client = socketio.AsyncClient(ssl_verify=ssl_verify)
        try:
            await socket_client.connect(
                socket_url,
                transports=["websocket"],
                wait_timeout=10,
                wait=True,
                socketio_path="socket.io"
            )
            print("Socket connected successfully")
        except Exception as e:
            print(f"Socket connection failed: {e}")
            socket_client = None

    # 2) Start Nova
    nova = NovaSonic(socket_client=socket_client)
    await nova.start_session()

    # 3) Grab the background task so we can cancel it
    stream_task = nova.response

    try:
        # run up to 5 minutes
        await asyncio.sleep(300)
    except asyncio.CancelledError:
        print("Task cancelled")
    finally:
        # 4) Clean up Nova
        nova.is_active = False
        if stream_task and not stream_task.done():
            stream_task.cancel()
        await nova.end_session()

        # 5) Clean up Socket.IO client (and aiohttp)
        if socket_client:
            await socket_client.disconnect()
            # also force close underlying aiohttp session
            sess = getattr(socket_client.eio, "_session", None)
            if sess:
                sess.close()

        print("Session ended")

if __name__ == "__main__":
    asyncio.run(run_nova())
