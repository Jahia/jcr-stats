import {gql} from '@apollo/client';

export const COMPUTE = gql`
    mutation JcrStatsCompute($path: String) {
        jcrStats {
            compute(path: $path)
        }
    }
`;

export const GET_STATUS = gql`
    query JcrStatsStatus {
        jcrStats {
            status {
                running
                path
                error
                hasResult
                startedAt
                elapsedMs
                visitedCount
            }
        }
    }
`;

export const GET_RESULT = gql`
    query JcrStatsResult($maxDepth: Int) {
        jcrStats {
            result(maxDepth: $maxDepth) {
                name
                path
                size
                nodeCount
                children {
                    name
                    path
                    size
                    nodeCount
                    children {
                        name
                        path
                        size
                        nodeCount
                        children {
                            name
                            path
                            size
                            nodeCount
                            children {
                                name
                                path
                                size
                                nodeCount
                                children {
                                    name
                                    path
                                    size
                                    nodeCount
                                    children {
                                        name
                                        path
                                        size
                                        nodeCount
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;
