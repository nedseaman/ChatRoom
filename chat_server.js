// Require the packages we will use:
const http = require("http"),
    fs = require("fs");
const { exit } = require("process");

const port = 3456;
const file = "client.html";
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html, on port 3456:
const server = http.createServer(function (req, res) {
    // This callback runs when a new connection is made to our HTTP server.

    fs.readFile(file, function (err, data) {
        // This callback runs when the client.html file has been read
        if (err) return res.writeHead(500);
        res.writeHead(200);
        res.end(data);
    });
});
server.listen(port);

// Import Socket.IO and pass our HTTP server object to it.
const socketio = require("socket.io")

//this is for storing all of the information about rooms, users, etc.
var rooms = {};

const io = socketio.listen(server);
io.on("connection", (socket) => {
    //as soon as you connect/make a username, will display all of the rooms
    io.to(socket.id).emit("list_rooms", { rooms: rooms });

    //takes all the information from client side and creates a room for you
    socket.on("create_room", (data) => {
        //if name of room is the same as another, then can't make it
        if (data.name in rooms) {
            io.to(socket.id).emit("failure", { type: "Duplicate room error", message: "A room with the same name has already been created." });
            return;
        } else if (!/^[A-Za-z0-9]+$/.test(data.name)) {
            io.to(socket.id).emit("failure", { type: "Invalid room name", message: "A room name must be a single string of alphanumeric characters." });
            return;
        }
        //if room name is valid, then makes the room and sends back to client
        rooms[data.name] = data;
        io.emit("list_rooms", { rooms: rooms });
    });

    //try to join a room!
    socket.on("join_room", (data) => {
        //if you're a banned user, then you won't be able to join (checks the rooms banned users list!)
        if (rooms[data.room].banned[socket.id]) {
            io.to(socket.id).emit("failure", { type: "Banned user", message: "You have been banned from this chat room." });
        } else {
            //if the room is private, then it checks if the password you typed in was valid
            if (rooms[data.room].private) {
                if (data.password == rooms[data.room].password) {
                    socket.join(data.room);
                    rooms[data.room].num_occupants += 1;
                    rooms[data.room].occupants[socket.id] = data.username;
                    io.emit("list_rooms", { rooms: rooms });
                    io.to(data.room).emit("list_occupants", { occupants: rooms[data.room].occupants, admin: rooms[data.room].admin });
                    io.to(data.room).emit("user_joined", { user: data.username });
                } else {    //if the password is invalid, then you can't join the room
                    io.to(socket.id).emit("failure", { type: "Wrong Password", message: "You typed in the wrong password." });
                }
            } else {
                //normal room join!
                socket.join(data.room);
                rooms[data.room].num_occupants += 1;
                rooms[data.room].occupants[socket.id] = data.username;
                //update the rooms list
                io.emit("list_rooms", { rooms: rooms });
                //list the occupants of the rooms
                io.to(data.room).emit("list_occupants", { occupants: rooms[data.room].occupants, admin: rooms[data.room].admin });
                //send a cute message when a user joins
                io.to(data.room).emit("user_joined", { user: data.username });
            }
        }
    });

    //joining a random room! one without a password
    socket.on("join_random_room", (data) => {
        if (Object.keys(rooms).length < 2) {
            io.to(socket.id).emit("failure", { type: "Random room failure", message: "Make more rooms to use this feature" });
            return;
        }

        let random_num = Math.floor(Math.random() * (Object.keys(rooms).length));
        let random_room = Object.keys(rooms)[random_num];
        while (rooms[random_room].private || rooms[random_room].banned[socket.id]) {
            random_num = Math.floor(Math.random() * (Object.keys(rooms).length));
            random_room = Object.keys(rooms)[random_num];
        }

        io.to(socket.id).emit("random_room_joined", { room: random_room });

        //normal room join!
        socket.join(random_room);
        rooms[random_room].num_occupants += 1;
        rooms[random_room].occupants[socket.id] = data.username;
        //update the rooms list
        io.emit("list_rooms", { rooms: rooms });
        //list the occupants of the rooms
        io.to(random_room).emit("list_occupants", { occupants: rooms[random_room].occupants, admin: rooms[random_room].admin });
        //send a cute message when a user joins
        io.to(random_room).emit("user_joined", { user: data.username });
    });

    //when you leave the room in any form
    socket.on("leave_room", (data) => {
        //updates the room's users
        if (!rooms[data.room]) {
            socket.leave(data.room);
        } else {
            socket.leave(data.room);
            rooms[data.room].num_occupants -= 1;
            delete rooms[data.room].occupants[socket.id];
            //list all the users again
            io.emit("list_rooms", { rooms: rooms });
            io.to(data.room).emit("list_occupants", { occupants: rooms[data.room].occupants, admin: rooms[data.room].admin });
            if (data.kicked) {  //if you were kicked, then a special message just for you is emitted
                io.to(data.room).emit("user_left", { user: data.user, kicked: data.kicked, banned: data.banned, kicking_user: data.kicking_user });
            } else if (data.banned) {   //if you were banned, then a special message just for you is also emitted
                rooms[data.room].banned[socket.id] = data.user;
                io.to(data.room).emit("user_left", { user: data.user, kicked: data.kicked, banned: data.banned, banning_user: data.banning_user });
            } else {    //if you just left the room of your own accord, then a normal message for you
                io.to(data.room).emit("user_left", { user: data.user, kicked: data.kicked });
            }
        }
    });

    //when you disconnect from the server (not leaving the room, two different things)
    socket.on("disconnecting", () => {
        let user;
        socket.rooms.forEach(room => {
            socket.leave(room);
            if (room != socket.id && rooms[room]) {
                user = rooms[room].occupants[socket.id];
                //updates the rooms list
                rooms[room].num_occupants -= 1;
                delete rooms[room].occupants[socket.id];
                io.to(room).emit("list_occupants", { occupants: rooms[room].occupants, admin: rooms[room].admin });

            } else {
                io.emit("list_rooms", { rooms: rooms });
                io.to(room).emit("user_left", { user: user });
            }
        });

        Object.keys(rooms).forEach(room_name => {
            if (rooms[room_name].admin == socket.id) {
                delete rooms[room_name];
            }
        });

        io.emit("list_rooms", { rooms: rooms });
    });

    //sending a message!
    socket.on("send_message", (data) => {
        // This callback runs when the server receives a new message from the client.
        if (data.private) { //for private messsage to subset of sockets
            if (data.recipients.includes(socket.id) == false) {
                io.to(socket.id).emit("receive_message", { message: data.message, user: data.user, private: true });
            }
            for (index in data.recipients) {
                io.to(data.recipients[index]).emit("receive_message", { message: data.message, user: data.user, private: true });
            }
        } else { // for public message
            io.to(data.room).emit("receive_message", { message: data.message, user: data.user, private: false }); // broadcast the message to other users
        }
    });

    //if you are doing the kicking
    socket.on("kick_user", (data) => {
        io.to(data.user).emit("kicked", { kicking_user: data.kicking_user });
    });

    //if you are doing the banning
    socket.on("ban_user", (data) => {
        io.to(data.user).emit("banned", { banning_user: data.banning_user });
    });

    //deleting a room
    socket.on("delete_room", (data) => {
        //relist all of the rooms in the lobby
        delete rooms[data.room];
        io.emit("list_rooms", { rooms: rooms });
    });
});