package com.argueit;

import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import io.javalin.websocket.WsContext;
import java.util.Set;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.sql.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonArray;

public class App{
    private static final Map<String, Set<WsContext>> rooms = new ConcurrentHashMap<>();
    private static final String DB_URL = "jdbc:sqlite:argueit.db";
    private static final Gson gson = new Gson();

    public static void main(String[] args){
        initDatabase();
        startReaperTask();

        Javalin app = Javalin.create(config -> {
            config.staticFiles.add("/frontend", Location.CLASSPATH);
        }).start(8080);

        app.ws("/tierlist/{roomId}", ws -> {
            ws.onConnect(ctx -> {
                String roomId = ctx.pathParam("roomId");
                rooms.computeIfAbsent(roomId, k -> ConcurrentHashMap.newKeySet()).add(ctx);
                updateRoomActivity(roomId);
                System.out.println("User joined room " + roomId + "! Total in room: " + rooms.get(roomId).size());
            });

            ws.onMessage(ctx -> {
                String roomId = ctx.pathParam("roomId");
                String message = ctx.message();

                if (message.contains("\"action\":\"ping\"") || message.contains("\"action\": \"ping\"")){
                    return;
                }

                updateRoomActivity(roomId);
                boolean broadcast = true;

                try{
                    JsonObject json = gson.fromJson(message, JsonObject.class);
                    String action = json.has("action") ? json.get("action").getAsString() : "";

                    if (action.equals("request_sync")){
                        sendSyncStateFromDb(roomId, ctx);
                        broadcast = false;
                    }
                    else if (action.equals("add")){
                        saveItem(roomId, json.get("itemId").getAsString(),json.get("url").getAsString(), "pool");
                    }
                    else if (action.equals("move")){
                        updateItemTier(roomId,json.get("itemId").getAsString(), json.get("targetTierId").getAsString());
                    }
                    else if (action.equals("delete")){
                        deleteItem(roomId, json.get("itemId").getAsString());
                    }
                    else if(action.equals("clear")){
                        clearRoomItems(roomId);
                    }
                    else if(action.equals("rename_tier")){
                        saveTierName(roomId, json.get("tierId").getAsString(), json.get("name").getAsString());
                    }
                }
                catch(Exception e){
                    System.err.println("JSON Parse Error: " + e.getMessage());
                }

                if (broadcast && rooms.containsKey(roomId)){
                    rooms.get(roomId).stream()
                            .filter(client -> client.session.isOpen() && !client.equals(ctx))
                            .forEach(client -> client.send(message));
                }
            });

            ws.onClose(ctx -> {
                String roomId = ctx.pathParam("roomId");
                if (rooms.containsKey(roomId)){
                    rooms.get(roomId).remove(ctx);
                    if(rooms.get(roomId).isEmpty()){
                        rooms.remove(roomId);
                    }
                }
            });
        });
    }

    private static void initDatabase(){
        try (Connection conn = DriverManager.getConnection(DB_URL);
            Statement stmt = conn.createStatement()){
            stmt.execute("PRAGMA foreign_keys = ON;");
            stmt.execute("CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY, last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
            stmt.execute("CREATE TABLE IF NOT EXISTS items (item_id TEXT, room_id TEXT, url TEXT, tier_id TEXT, PRIMARY KEY(item_id, room_id), FOREIGN KEY(room_id) REFERENCES rooms(room_id) ON DELETE CASCADE)");
            stmt.execute("CREATE TABLE IF NOT EXISTS tiers (room_id TEXT, tier_id TEXT, name TEXT, PRIMARY KEY(room_id, tier_id), FOREIGN KEY(room_id) REFERENCES rooms(room_id) ON DELETE CASCADE)");
        }
        catch (SQLException e) {e.printStackTrace();}
    }

    private static void startReaperTask(){
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(() -> {
            try(Connection conn = DriverManager.getConnection(DB_URL);
                Statement stmt = conn.createStatement()){
                stmt.execute("PRAGMA foreign_keys = ON;");
                int deleted = stmt.executeUpdate("DELETE FROM rooms WHERE last_active <= datetime('now', '-1 day')");
                if (deleted > 0) System.out.println("Reaper Task: Auto-deleted " + deleted + " expired rooms.");
            }
            catch (SQLException e) {e.printStackTrace();}
        }, 0, 1, TimeUnit.HOURS);
    }

    private static void updateRoomActivity(String roomId){
        String sql = "INSERT INTO rooms (room_id, last_active) VALUES (?, datetime('now')) ON CONFLICT(room_id) DO UPDATE SET last_active = datetime('now')";
        try (Connection conn = DriverManager.getConnection(DB_URL);
            PreparedStatement pstmt = conn.prepareStatement(sql)){
            pstmt.setString(1, roomId);
            pstmt.executeUpdate();
        }catch (SQLException e) {e.printStackTrace();}
    }

    private static void saveItem(String roomId, String itemId, String url, String tierId){
        String sql = "INSERT OR REPLACE INTO items (item_id, room_id, url, tier_id) VALUES (?, ?, ?, ?)";
        try (Connection conn = DriverManager.getConnection(DB_URL);
            PreparedStatement pstmt = conn.prepareStatement(sql)){
            pstmt.setString(1, itemId);
            pstmt.setString(2, roomId);
            pstmt.setString(3, url);
            pstmt.setString(4, tierId);
            pstmt.executeUpdate();
        }
        catch(SQLException e) {e.printStackTrace();}
    }

    private static void updateItemTier(String roomId, String itemId, String tierId){
        String sql = "UPDATE items Set tier_id = ? WHERE item_id = ? AND room_id = ?";
        try (Connection conn = DriverManager.getConnection(DB_URL);
            PreparedStatement pstmt = conn.prepareStatement(sql)){
            pstmt.setString(1, tierId);
            pstmt.setString(2, itemId);
            pstmt.setString(3, roomId);
            pstmt.executeUpdate();
        }
        catch(SQLException e) {e.printStackTrace();}
    }

    private static void deleteItem(String roomId, String itemId){
        String sql = "DELETE FROM items WHERE item_id = ? AND room_id = ?";
        try (Connection conn = DriverManager.getConnection(DB_URL);
            PreparedStatement pstmt = conn.prepareStatement(sql)){
            pstmt.setString(1, itemId);
            pstmt.setString(2, roomId);
            pstmt.executeUpdate();
        }
        catch(SQLException e) { e.printStackTrace();}
    }

    private static void clearRoomItems(String roomId){
        String sql = "DELETE FROM items WHERE room_id =?";
        try(Connection conn = DriverManager.getConnection(DB_URL);
            PreparedStatement pstmt = conn.prepareStatement(sql)){
            pstmt.setString(1, roomId);
            pstmt.executeUpdate();
        }
        catch(SQLException e) {e.printStackTrace();}
    }

    private static void saveTierName(String roomId, String tierId, String name){
        String sql = "INSERT OR REPLACE INTO tiers (room_id, tier_id, name) VALUES (?, ?, ?)";
        try (Connection conn = DriverManager.getConnection(DB_URL);
        PreparedStatement pstmt = conn.prepareStatement(sql)){
            pstmt.setString(1, roomId);
            pstmt.setString(2, tierId);
            pstmt.setString(3, name);
            pstmt.executeUpdate();
        }catch (SQLException e){e.printStackTrace();}
    }

    private static void sendSyncStateFromDb(String roomId, WsContext ctx){
        JsonObject response = new JsonObject();
        response.addProperty("action", "sync_state");

        JsonArray itemsArray = new JsonArray();
        JsonObject tiersObject = new JsonObject();

        try (Connection conn = DriverManager.getConnection(DB_URL)){
            String tiersSql = "SELECT tier_id, name FROM tiers WHERE room_id = ?";
            try (PreparedStatement pstmt = conn.prepareStatement(tiersSql)){
                pstmt.setString(1, roomId);
                ResultSet rs = pstmt.executeQuery();
                while(rs.next()){
                    tiersObject.addProperty(rs.getString("tier_id"), rs.getString("name"));
                }
            }

            String itemsSql = "SELECT item_id, url, tier_id FROM items WHERE room_id = ?";
            try(PreparedStatement pstmt = conn.prepareStatement(itemsSql)){
                pstmt.setString(1, roomId);
                ResultSet rs = pstmt.executeQuery();
                while (rs.next()){
                    JsonObject item = new JsonObject();
                    item.addProperty("id", rs.getString("item_id"));
                    item.addProperty("url", rs.getString("url"));
                    item.addProperty("tier", rs.getString("tier_id"));
                    itemsArray.add(item);
                }
            }
        } catch (SQLException e){
            e.printStackTrace();
        }

        if (itemsArray.size() > 0 || tiersObject.size() > 0){
            response.add("items", itemsArray);
            response.add("tiers", tiersObject);
            ctx.send(gson.toJson(response));
        }
    }
}