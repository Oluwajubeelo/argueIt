package com.argueit;

import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import io.javalin.websocket.WsContext;
import java.util.Set;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class App {
    private static final Map<String, Set<WsContext>> rooms = new ConcurrentHashMap<>();

    public static void main(String[] args) {
        Javalin app = Javalin.create(config -> {
            config.staticFiles.add("/frontend", Location.CLASSPATH);
        }).start(8080);


        app.ws("/tierlist/{roomId}", ws -> {
            ws.onConnect(ctx -> {
                String roomId = ctx.pathParam("roomId");
                rooms.computeIfAbsent(roomId, k -> ConcurrentHashMap.newKeySet()).add(ctx);
                System.out.println("User joined room " + roomId + "! Total in room: " + rooms.get(roomId).size());
            });

            ws.onMessage(ctx -> {
                String roomId = ctx.pathParam("roomId");
                String message = ctx.message();

                if (message.contains("\"action\":\"ping\"") || message.contains("\"action\": \"ping\"")){
                    return;
                }

                if (rooms.containsKey(roomId)){
                    rooms.get(roomId).stream()
                        .filter(client -> client.session.isOpen() && !client.equals(ctx))
                        .forEach(client -> client.send(message));
                }
            });

            //when someone closes their tab
            ws.onClose(ctx -> {
                String roomId = ctx.pathParam("roomId");
                if (rooms.containsKey(roomId)) {
                    rooms.get(roomId).remove(ctx);
                    System.out.println("Someone left room " + roomId + ". Total in room: " + rooms.get(roomId).size());

                    if(rooms.get(roomId).isEmpty()){
                        rooms.remove(roomId);
                    }
                }
            });
        });
    }
}
