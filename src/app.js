import express from "express";
import cors from "cors";
import dayjs from "dayjs";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { stripHtml } from "string-strip-html";
import { messageSchema, participantSchema } from "./schemas.js";
dotenv.config();
// Create a new MongoClient
const client = new MongoClient(process.env.DATABASE_URL);
let db;

client
	.connect()
	.then(() => {
		db = client.db();
		console.log("Connected to Client");
	})
	.catch((err) => {
		console.log(err);
	});

async function addMessage(from, to, text, type, time) {
	try {
		const messages = db.collection("messages");
		const message = { from, to, text, type, time };
		await messages.insertOne(message);
	} catch {
		console.log("Error adding message");
	}
}

async function checkConflict(name) {
	let result;
	try {
		const participants = db.collection("participants");
		result = await participants.findOne({ name });
	} catch {
		console.log("Error checking conflict");
		result = false;
	} finally {
		return result;
	}
}

async function findInactiveParticipants(time) {
	let result;
	try {
		const participants = db.collection("participants");
		result = await participants
			.find({ lastStatus: { $lt: time } })
			.toArray();
	} catch {
		console.log("Error finding participants");
		result = [];
	} finally {
		return result;
	}
}

async function removeParticipant(name) {
	try {
		const participants = db.collection("participants");
		await participants.deleteOne({ name });
	} catch {
		console.log("Error removing participants");
	}
}

async function addParticipant(name) {
	try {
		const participants = db.collection("participants");
		const participant = { name: name, lastStatus: Date.now() };
		await participants.insertOne(participant);
	} catch {
		console.log("Error adding participant");
	}
}

async function validateChange(id, user) {
	const message = await db
		.collection("messages")
		.findOne({ _id: ObjectId(id) });
	if (!message) {
		return { status: 404, valid: false };
	} else if (message.from !== user) {
		return { status: 401, valid: false };
	} else {
		return { status: 200, valid: true };
	}
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/messages", async (req, res) => {
	try {
		const limit = req.query.limit;
		if (limit && (isNaN(parseInt(limit)) || parseInt(limit) < 1)) {
			res.sendStatus(422);
			return;
		}
		const { user } = req.headers;
		const messages = await db
			.collection("messages")
			.find({
				$or: [
					{ type: "message" },
					{ type: "status" },
					{
						$and: [
							{ type: "private_message" },
							{ $or: [{ to: user }, { from: user }] },
						],
					},
				],
			})
			.toArray();
		res.send(messages?.slice(-parseInt(limit)).reverse());
	} catch {
		res.sendStatus(500);
	}
});

app.post("/status", async (req, res) => {
	try {
		const { user } = req.headers;
		const update = await db
			.collection("participants")
			.updateOne({ name: user }, { $set: { lastStatus: Date.now() } });
		if (update.matchedCount === 0) {
			res.sendStatus(404);
		} else {
			res.sendStatus(200);
		}
	} catch {
		res.sendStatus(500);
	}
});

app.post("/messages", async (req, res) => {
	try {
		const { user } = req.headers;
		const findUser = await db
			.collection("participants")
			.findOne({ name: user });
		const message = req.body;
		const { error } = messageSchema.validate(message);
		if (error || !findUser) {
			res.status(422).send(error);
			return;
		}
		message.text = stripHtml(message.text).result.trim();
		message.to = stripHtml(message.to).result.trim();
		message.type = stripHtml(message.type).result.trim();
		const time = dayjs().format("HH:mm:ss");
		const { to, text, type } = message;
		await addMessage(stripHtml(user).result.trim(), to, text, type, time);
		res.sendStatus(201);
	} catch {
		res.sendStatus(500);
	}
});

app.get("/participants", (_, res) => {
	try {
		db.collection("participants")
			.find()
			.toArray()
			.then((result) => {
				res.status(200).send(result);
			});
	} catch {
		res.sendStatus(500);
	}
});

app.post("/participants", async (req, res) => {
	try {
		const participant = req.body;
		const { error } = participantSchema.validate(participant);
		if (error) {
			res.sendStatus(422);
			return;
		}
		participant.name = stripHtml(participant.name).result.trim();
		const conflict = await checkConflict(participant.name);
		if (conflict) {
			res.sendStatus(409);
		} else {
			const time = dayjs().format("HH:mm:ss");
			await addParticipant(participant.name);
			await addMessage(
				participant.name,
				"Todos",
				"entra na sala...",
				"status",
				time
			);
			res.sendStatus(201);
		}
	} catch {
		res.sendStatus(500);
	}
});

app.delete("/messages/:id", async (req, res) => {
	try {
		const { id } = req.params;
		const { user } = req.headers;
		const { status, valid } = await validateChange(id, user);
		if (valid) {
			await db.collection("messages").deleteOne({ _id: ObjectId(id) });
		}
		res.sendStatus(status);
	} catch {
		res.sendStatus(500);
	}
});

app.put("/messages/:id", async (req, res) => {
	try {
		const { id } = req.params;
		const { user } = req.headers;
		const newMessage = req.body;
		const { error } = messageSchema.validate(newMessage);
		if (error) {
			res.sendStatus(422);
			return;
		}
		const { status, valid } = await validateChange(id, user);
		if (valid) {
			await db
				.collection("messages")
				.updateOne({ _id: ObjectId(id) }, { $set: newMessage });
		}
		res.sendStatus(status);
	} catch {
		res.sendStatus(500);
	}
});

function removeInactive() {
	const interval = 15000;
	const tolerance = 10000;
	setInterval(async () => {
		let participants;
		await findInactiveParticipants(Date.now() - tolerance).then(
			(result) => {
				participants = result.map((participant) => participant.name);
			}
		);
		const promises = participants.map(async (participant) => {
			const time = dayjs().format("HH:mm:ss");
			await removeParticipant(participant);
			await addMessage(
				participant,
				"Todos",
				"sai da sala...",
				"status",
				time
			);
		});
		await Promise.all(promises);
		//Maybe remove this console log once development is done
		//console.log(`Removed participants: ${participants}`);
	}, interval);
}

const PORT = 5000;
app.listen(PORT, () => {
	console.log(`Server started on port ${PORT}`);
	removeInactive();
});
