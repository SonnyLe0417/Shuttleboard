"""Check wire decoding without loading the model or opening a camera."""
import asyncio
import struct
import sys
import types
import numpy as np
from fastapi import FastAPI, WebSocketDisconnect

seen = []
def detect(model, windows):
    seen.extend(int(frame[0, 0]) for frame in windows[0])
    return [(0.4, 0.6, 0.9, True)]

sys.modules['tracknet_service'] = types.SimpleNamespace(
    app=FastAPI(), _load_model=lambda: object(), _detect_batch=detect,
    _active_backend='test', _active_device='test')
import tracknet_live

class Socket:
    def __init__(self, packet):
        self.packet = packet
        self.messages = []
    async def accept(self): pass
    async def close(self): pass
    async def receive_bytes(self):
        if self.packet is None: raise WebSocketDisconnect()
        result, self.packet = self.packet, None
        return result
    async def send_json(self, message): self.messages.append(message)

async def test():
    packet = struct.pack('<dd', 42, 123456) + b''.join(bytes([i])*(512*288) for i in [8,9,10])
    socket = Socket(packet)
    await tracknet_live.live(socket)
    assert seen == [8,9,10]
    assert socket.messages[-1]['frame'] == 42
    assert socket.messages[-1]['timestamp'] == 123456
    assert socket.messages[-1]['visible'] is True
    invalid = Socket(b'bad')
    await tracknet_live.live(invalid)
    assert invalid.messages[-1]['type'] == 'error'
    print('PASS: service binary decoding, frame order, timestamps, invalid packet')

asyncio.run(test())
