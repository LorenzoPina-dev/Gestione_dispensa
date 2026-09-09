# Event schemas

One JSON Schema per versioned event type belongs here. Producers and consumers validate against
the same immutable schema; incompatible changes require a new event version.
